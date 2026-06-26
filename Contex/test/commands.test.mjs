import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';

function fresh(opts) {
  const c = createContex(opts);
  c.createWorkspace({ name: 'test', repository_path: '/repo' });
  c.setState({ tile_id: 'term', tile_type: 'terminal', status: 'working' });
  return c;
}

test('canvas_create_tile: agent enqueues, consumer fulfills, agent gets the new tile id', () => {
  const c = fresh();
  const ws = c.soleWorkspace().id;
  const cmd = c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'terminal', title: 'Visual QA' });
  assert.equal(cmd.status, 'accepted');

  // CodeSurf consumer pulls, creates the tile, reports the id
  const pending = c.nextCommands(ws);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'delivered');
  c.setState({ tile_id: 'child-1', tile_type: 'terminal', status: 'idle' });
  const done = c.completeCommand({ command_id: cmd.id, result: { tile_id: 'child-1' } });
  assert.equal(done.status, 'completed');

  // the requester can read the new tile id off the command result
  assert.equal(c.getCommand(cmd.id).result.tile_id, 'child-1');
  c.close();
});

test('commands stay queued while the canvas is offline', () => {
  const c = fresh();
  const ws = c.soleWorkspace().id;
  c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'chat' });
  // no consumer has pulled yet
  assert.equal(c.listCommands(ws)[0].status, 'accepted');
  // later, the consumer comes online and drains the queue
  assert.equal(c.nextCommands(ws).length, 1);
  c.close();
});

test('at-least-once delivery: a command can be pulled twice, completion is idempotent', () => {
  const c = fresh();
  const ws = c.soleWorkspace().id;
  const cmd = c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'chat' });
  assert.equal(c.nextCommands(ws).length, 1); // delivered
  assert.equal(c.nextCommands(ws).length, 1); // still re-delivered (not yet completed)
  c.completeCommand({ command_id: cmd.id, result: { tile_id: 'x' } });
  const replay = c.completeCommand({ command_id: cmd.id, result: { tile_id: 'y' } });
  assert.equal(replay.result.tile_id, 'x'); // first completion wins
  assert.equal(c.nextCommands(ws).length, 0); // completed -> no longer pending
  c.close();
});

test('invalid tile_type is rejected; consumer can also fail a command', () => {
  const c = fresh();
  assert.throws(() => c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'nonsense' }), (e) => e.code === ErrorCodes.BAD_REQUEST);
  const cmd = c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'terminal' });
  const failed = c.completeCommand({ command_id: cmd.id, error: 'user declined' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'user declined');
  c.close();
});

test('terminal input: permission + capability + control-confirmation rules', () => {
  const c = fresh();
  c.setState({ tile_id: 'shell', tile_type: 'terminal', status: 'working', capabilities: ['terminal_input'] });
  // not linked -> rejected
  assert.throws(() => c.terminalSendInput({ requester_tile_id: 'term', target_tile_id: 'shell', text: 'ls' }), (e) => e.code === ErrorCodes.PEER_NOT_LINKED);
  c.linkTiles({ source_tile_id: 'term', target_tile_id: 'shell' });

  // target without the capability -> rejected
  c.setState({ tile_id: 'plain', tile_type: 'terminal', status: 'idle' });
  c.linkTiles({ source_tile_id: 'term', target_tile_id: 'plain' });
  assert.throws(() => c.terminalSendInput({ requester_tile_id: 'term', target_tile_id: 'plain', text: 'ls' }), (e) => e.code === ErrorCodes.BAD_REQUEST);

  // text input on a capable, linked target -> ok
  assert.equal(c.terminalSendInput({ requester_tile_id: 'term', target_tile_id: 'shell', text: 'ls' }).status, 'accepted');

  // control sequence without confirm -> denied; with confirm -> ok
  assert.throws(() => c.terminalSendInput({ requester_tile_id: 'term', target_tile_id: 'shell', control: 'C-c' }), (e) => e.code === ErrorCodes.SCOPE_DENIED);
  assert.equal(c.terminalSendInput({ requester_tile_id: 'term', target_tile_id: 'shell', control: 'C-c', confirm: true }).status, 'accepted');
  c.close();
});

test('stale commands expire (timeout / canvas never came online)', () => {
  let t = 1_000_000_000;
  const c = fresh({ clock: () => t });
  const ws = c.soleWorkspace().id;
  c.canvasCreateTile({ requester_tile_id: 'term', tile_type: 'chat' });
  t += 25 * 3600 * 1000; // 25h later, still undelivered
  assert.equal(c.expireStaleCommands({ olderThanMs: 24 * 3600 * 1000 }), 1);
  assert.equal(c.listCommands(ws)[0].status, 'expired');
  c.close();
});
