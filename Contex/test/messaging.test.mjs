import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';
import { callTool } from '../src/tools.mjs';

function fresh(opts) {
  const c = createContex(opts);
  c.createWorkspace({ name: 'test' });
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'b', tile_type: 'chat', status: 'idle' });
  return c;
}

test('direct messages require a canvas link', () => {
  const c = fresh();
  assert.throws(
    () => c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'hi' }),
    (e) => e.code === ErrorCodes.PEER_NOT_LINKED,
  );
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  const m = c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'hi', requires_ack: true });
  assert.equal(m.text, 'hi');
  assert.equal(m.read_at, null);
  c.close();
});

test('reading marks messages read and supports unread-only', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'one' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'two' });
  assert.equal(c.unreadCount('b'), 2);
  const first = c.readMessages({ tile_id: 'b' });
  assert.equal(first.length, 2);
  assert.ok(first[0].read_at);
  // already read -> unread-only returns nothing
  assert.equal(c.readMessages({ tile_id: 'b' }).length, 0);
  assert.equal(c.unreadCount('b'), 0);
  c.close();
});

test('acknowledge stamps messages that require it', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'please ack', requires_ack: true });
  const msgs = c.readMessages({ tile_id: 'b', acknowledge: true });
  assert.ok(msgs[0].acknowledged_at);
  c.close();
});

test('chat_send_message requires a chat target and a link', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  // b is a chat tile -> ok
  const m = c.chatSendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'hi chat', requires_ack: true });
  assert.equal(m.text, 'hi chat');
  // sending to a non-chat tile is rejected
  c.setState({ tile_id: 'term2', tile_type: 'terminal', status: 'idle' });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'term2' });
  assert.throws(
    () => c.chatSendMessage({ from_tile_id: 'a', to_tile_id: 'term2', text: 'nope' }),
    (e) => e.code === ErrorCodes.BAD_REQUEST,
  );
  c.close();
});

test('chat_acknowledge stamps acknowledged_at and only the recipient may ack', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  const m = c.chatSendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'please ack', requires_ack: true });
  // sender cannot acknowledge their own message to b
  assert.throws(() => c.acknowledgeMessage({ message_id: m.id, tile_id: 'a' }), (e) => e.code === ErrorCodes.BAD_REQUEST);
  const acked = c.acknowledgeMessage({ message_id: m.id, tile_id: 'b' });
  assert.ok(acked.acknowledged_at);
  c.close();
});

test('messages are returned in priority order', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'normal', priority: 'normal' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'urgent', priority: 'urgent' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'low', priority: 'low' });
  const order = c.readMessages({ tile_id: 'b' }).map((m) => m.text);
  assert.deepEqual(order, ['urgent', 'normal', 'low']);
  c.close();
});

test('a message sent to an offline tile is read after reconnect', () => {
  let t = 1_000_000;
  const c = fresh({ clock: () => t, heartbeatTimeoutMs: 30_000 });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  t += 60_000; // b goes offline (no heartbeat)
  assert.equal(c.getTile('b').online, false);
  // messaging does not require the recipient to be online; it persists
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'while you were away' });
  // b reconnects and reads
  c.setState({ tile_id: 'b', tile_type: 'chat', status: 'idle' });
  const inbox = c.readMessages({ tile_id: 'b' });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].text, 'while you were away');
  c.close();
});

test('duplicate idempotency_key sends the message only once', () => {
  const c = fresh();
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  const args = { from_tile_id: 'a', to_tile_id: 'b', text: 'once', idempotency_key: 'k-send-1' };
  callTool(c, 'peer_send_message', args);
  callTool(c, 'peer_send_message', args);
  assert.equal(c.unreadCount('b'), 1);
  c.close();
});

test('notify with human_attention emits and returns its level', () => {
  const c = fresh();
  let got = null;
  c.events.on('notification', (n) => { if (n.method.endsWith('human_attention')) got = n; });
  const r = c.notify({ text: 'need a decision', level: 'human_attention', tile_id: 'a' });
  assert.equal(r.level, 'human_attention');
  assert.ok(got, 'human_attention notification emitted');
  assert.equal(got.params.text, 'need a decision');
  c.close();
});

test('purgeExpiredMessages removes messages past the retention window', () => {
  let t = 10 * 86_400_000; // day 10
  const c = fresh({ clock: () => t });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'old' });
  t += 40 * 86_400_000; // 40 days later
  c.sendMessage({ from_tile_id: 'a', to_tile_id: 'b', text: 'new' });
  const removed = c.purgeExpiredMessages({ olderThanDays: 30 });
  assert.equal(removed, 1);
  assert.deepEqual(c.listInbox('b').map((m) => m.text), ['new']);
  c.close();
});

test('todos can be assigned and completed', () => {
  const c = fresh();
  const todo = c.addTodo({ creator_tile_id: 'a', assignee_tile_id: 'b', title: 'Verify settings modal' });
  assert.equal(todo.status, 'open');
  const done = c.completeTodo({ todo_id: todo.id, completing_tile_id: 'b', result_summary: 'looks good' });
  assert.equal(done.status, 'done');
  assert.equal(done.result_summary, 'looks good');
  c.close();
});
