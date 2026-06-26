import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';
import { ContexConnection } from '../src/contex-connection.mjs';
import { startMockMcp } from './helpers/mock-mcp.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('without Contex, status is disconnected and link ops are 503', async () => {
  const store = new WorkspaceStore(tmp('cs-nc-'));
  const { server, url } = await startServer({ store, port: 0 });
  const base = url.replace(/\/$/, '');
  const status = await (await fetch(base + '/api/contex/status')).json();
  assert.equal(status.status, 'disconnected');
  const link = await fetch(base + '/api/contex/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"source":"a","target":"b"}' });
  assert.equal(link.status, 503);
  server.close();
});

test('Contex endpoints: status (no token), link mirror, SSE events', async () => {
  const linkCalls = [];
  const mock = await startMockMcp({ tools: {
    link_tiles: (a) => { linkCalls.push(['link', a]); return { ok: true }; },
    unlink_tiles: (a) => { linkCalls.push(['unlink', a]); return { unlinked: 1 }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });

  const store = new WorkspaceStore(tmp('cs-c-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  // status exposes url + workspace but NOT the token
  const status = await (await fetch(base + '/api/contex/status')).json();
  assert.equal(status.status, 'connected');
  assert.equal(status.workspaceId, 'ws_1');
  assert.ok(!('token' in status));
  assert.ok(!JSON.stringify(status).includes('tok-a'));

  // mirror a link
  const r = await fetch(base + '/api/contex/links', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'tile_a', target: 'tile_b', directed: true }),
  });
  assert.equal(r.status, 200);
  const link = linkCalls.find((c) => c[0] === 'link')[1];
  assert.equal(link.source_tile_id, 'tile_a');
  assert.equal(link.directed, true);

  // SSE events: read the initial status frame, then a pushed tile_state
  const ac = new AbortController();
  const res = await fetch(base + '/api/contex/events', { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  async function readUntil(pred, budgetMs = 1500) {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (pred(buf)) return true;
    }
    return false;
  }
  assert.ok(await readUntil((b) => b.includes('event: status')), 'should get a status frame');
  await wait(20);
  mock.push({ method: 'notifications/context/tile_state_changed', params: { tile_id: 't1', status: 'working' } });
  assert.ok(await readUntil((b) => b.includes('event: tile_state') && b.includes('"t1"')), 'should get tile_state frame');
  ac.abort();

  server.close();
  await conn.stop();
  await mock.close();
});
