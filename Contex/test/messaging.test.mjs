import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';

function fresh() {
  const c = createContex();
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

test('todos can be assigned and completed', () => {
  const c = fresh();
  const todo = c.addTodo({ creator_tile_id: 'a', assignee_tile_id: 'b', title: 'Verify settings modal' });
  assert.equal(todo.status, 'open');
  const done = c.completeTodo({ todo_id: todo.id, completing_tile_id: 'b', result_summary: 'looks good' });
  assert.equal(done.status, 'done');
  assert.equal(done.result_summary, 'looks good');
  c.close();
});
