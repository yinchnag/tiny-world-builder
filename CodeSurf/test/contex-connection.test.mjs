import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ContexConnection } from '../src/contex-connection.mjs';
import { startMockMcp } from './helpers/mock-mcp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('connectDirect connects and reports status', async () => {
  const mock = await startMockMcp();
  const conn = new ContexConnection({ drainIntervalMs: 50 });
  const statuses = [];
  conn.on('status', (s) => statuses.push(s));
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  assert.equal(conn.status, 'connected');
  assert.deepEqual(statuses, ['connecting', 'connected']);
  await conn.stop();
  await mock.close();
});

test('linkTiles / unlinkTiles mirror to Contex with the right arg names', async () => {
  const calls = [];
  const mock = await startMockMcp({ tools: {
    link_tiles: (a) => { calls.push(['link', a]); return { ok: true }; },
    unlink_tiles: (a) => { calls.push(['unlink', a]); return { unlinked: 1 }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 }); // keep drain out of the way
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });

  await conn.linkTiles('tile_a', 'tile_b', { directed: true });
  await conn.unlinkTiles('tile_a', 'tile_b');

  const link = calls.find((c) => c[0] === 'link')[1];
  assert.equal(link.source_tile_id, 'tile_a');
  assert.equal(link.target_tile_id, 'tile_b');
  assert.equal(link.directed, true);
  assert.equal(link.workspace_id, 'ws_1');
  const unlink = calls.find((c) => c[0] === 'unlink')[1];
  assert.equal(unlink.source_tile_id, 'tile_a');
  assert.equal(unlink.workspace_id, 'ws_1');
  await conn.stop();
  await mock.close();
});

test('queued canvas commands are delivered and can be completed', async () => {
  let served = false;
  const completed = [];
  const mock = await startMockMcp({ tools: {
    canvas_next_commands: () => {
      if (served) return { commands: [] };
      served = true;
      return { commands: [{ command_id: 'cmd_1', type: 'canvas_create_tile', payload: { tile_type: 'terminal' } }] };
    },
    canvas_complete_command: (a) => { completed.push(a); return { ok: true }; },
  } });
  const conn = new ContexConnection({ drainIntervalMs: 30 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });

  const [cmd] = await once(conn, 'command');
  assert.equal(cmd.command_id, 'cmd_1');
  assert.equal(cmd.type, 'canvas_create_tile');

  // CodeSurf fulfilled it → report the new tile id
  await conn.completeCommand('cmd_1', { tile_id: 'tile_new' });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].command_id, 'cmd_1');
  assert.deepEqual(completed[0].result, { tile_id: 'tile_new' });
  await conn.stop();
  await mock.close();
});

test('a canvas_command notification wakes the drain immediately', async () => {
  let calls = 0;
  const mock = await startMockMcp({ tools: {
    canvas_next_commands: () => {
      calls++;
      // emit a command only on the notification-triggered drain (2nd+ call)
      return calls >= 2 ? { commands: [{ command_id: 'cmd_x', type: 'canvas_focus' }] } : { commands: [] };
    },
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 }); // long interval, so only the wake matters
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  await wait(40); // let the initial drain run

  const got = once(conn, 'command');
  mock.push({ method: 'notifications/context/canvas_command', params: { workspace_id: 'ws_1' } });
  const [cmd] = await got;
  assert.equal(cmd.command_id, 'cmd_x');
  await conn.stop();
  await mock.close();
});

test('forwards tile_state_changed as a typed event', async () => {
  const mock = await startMockMcp({ tools: { canvas_next_commands: () => ({ commands: [] }) } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  await wait(40);
  const got = once(conn, 'tile_state');
  mock.push({ method: 'notifications/context/tile_state_changed', params: { tile_id: 't1', status: 'working' } });
  const [params] = await got;
  assert.equal(params.tile_id, 't1');
  assert.equal(params.status, 'working');
  await conn.stop();
  await mock.close();
});

test('token rotation flips status to offline on the failing call', async () => {
  const mock = await startMockMcp({ token: 'tok-a', tools: { canvas_next_commands: () => ({ commands: [] }) } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  mock.setToken('tok-b');
  await assert.rejects(() => conn.call('peer_get_state', { tile_id: 't1' }));
  assert.equal(conn.status, 'offline');
  await conn.stop();
  await mock.close();
});
