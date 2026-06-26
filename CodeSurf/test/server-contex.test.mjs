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

test('chat: register, send to linked recipients, read messages', async () => {
  const sent = [];
  const mock = await startMockMcp({ tools: {
    peer_set_state: (a) => ({ tile_id: a.tile_id, type: a.tile_type, status: a.status, version: 1 }),
    peer_send_message: (a) => { sent.push(a); return { id: 'm_' + sent.length, ok: true }; },
    peer_read_messages: () => ({ messages: [{ id: 'm1', from_tile_id: 'agent_1', text: 'hello human', created_at: '2026-06-26T00:00:00Z' }] }),
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  const store = new WorkspaceStore(tmp('cs-chat-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  // register the chat tile
  let r = await fetch(`${base}/api/contex/chat/chat_1/register`, { method: 'POST' });
  assert.equal(r.status, 200);

  // send to two linked recipients → two peer_send_message calls from the chat tile
  r = await fetch(`${base}/api/contex/chat/chat_1/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'do the thing', recipients: ['agent_1', 'agent_2'] }),
  });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].from_tile_id, 'chat_1');
  assert.equal(sent[0].to_tile_id, 'agent_1');
  assert.equal(sent[0].text, 'do the thing');

  // read the chat tile's inbox
  const msgs = await (await fetch(`${base}/api/contex/chat/chat_1/messages`)).json();
  assert.equal(msgs.messages.length, 1);
  assert.equal(msgs.messages[0].from_tile_id, 'agent_1');
  assert.equal(msgs.messages[0].text, 'hello human');

  server.close();
  await conn.stop();
  await mock.close();
});

test('command bus: command is forwarded over SSE and completed via the endpoint', async () => {
  const completed = [];
  const mock = await startMockMcp({ tools: {
    canvas_next_commands: () => ({ commands: [] }), // no auto-drain noise
    canvas_complete_command: (a) => { completed.push(a); return { ok: true }; },
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  const store = new WorkspaceStore(tmp('cs-cmd-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  const ac = new AbortController();
  const res = await fetch(base + '/api/contex/events', { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readUntil = async (pred, ms = 1500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); if (pred(buf)) return true; }
    return false;
  };
  await readUntil((b) => b.includes('event: status'));

  // simulate a drained command being relayed to the browser
  conn.emit('command', { id: 'cmd_b', kind: 'create_tile', payload: { tile_type: 'chat' }, requester_tile_id: 'r' });
  assert.ok(await readUntil((b) => b.includes('event: command') && b.includes('cmd_b')), 'command should reach the browser');
  ac.abort();

  // the browser (here, the test) reports the result back
  const done = await fetch(`${base}/api/contex/commands/cmd_b/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result: { tile_id: 't_new' } }),
  });
  assert.equal(done.status, 200);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].command_id, 'cmd_b');
  assert.deepEqual(completed[0].result, { tile_id: 't_new' });

  server.close();
  await conn.stop();
  await mock.close();
});
