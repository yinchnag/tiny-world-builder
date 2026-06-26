import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { startServer } from '../src/server.mjs';
import { createToken } from '../src/auth.mjs';
import { MockAgent } from './helpers.mjs';

async function startTestServer() {
  const contex = createContex();
  contex.createWorkspace({ name: 'test', repository_path: '/repo' });
  const token = createToken();
  const srv = await startServer({ contex, token });
  return { ...srv, contex, close: async () => { await srv.close(); contex.close(); } };
}

test('E2E: two mock agents register, link, coordinate over HTTP', async () => {
  const srv = await startTestServer();
  try {
    const a = new MockAgent(srv.url, srv.token, 'term-a'); // terminal (Claude)
    const b = new MockAgent(srv.url, srv.token, 'chat-b');  // chat (Codex/human)

    // both register their presence
    assert.equal((await a.setState({ tile_type: 'terminal', status: 'idle', task: 'Ready' })).data.version, 1);
    assert.equal((await b.setState({ tile_type: 'chat', status: 'idle' })).data.version, 1);

    // before linking, A sees no peers
    assert.equal((await a.getState()).data.peers.length, 0);

    // owner/CodeSurf wires the canvas edge
    const linked = await a.tool('link_tiles', { source_tile_id: 'term-a', target_tile_id: 'chat-b' });
    assert.equal(linked.isError, false);

    // now A discovers B and the chat tools it exposes
    const view = (await a.getState()).data;
    assert.equal(view.peers.length, 1);
    assert.equal(view.peers[0].tile_id, 'chat-b');
    assert.deepEqual(view.peers[0].available_tools, ['chat_send_message', 'chat_acknowledge']);

    // A starts working and declares a file edit
    await a.setState({ status: 'working', task: 'Edit settings', files: [{ path: 'engine/world/30.js', mode: 'edit' }] });

    // B messages A; A reads it back
    const sent = await b.tool('peer_send_message', { from_tile_id: 'chat-b', to_tile_id: 'term-a', text: 'Are you done with 30.js?', requires_ack: true });
    assert.equal(sent.isError, false);
    const inbox = (await a.readMessages()).data.messages;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].text, 'Are you done with 30.js?');
  } finally {
    await srv.close();
  }
});

test('unauthenticated and wrong-token requests are rejected', async () => {
  const srv = await startTestServer();
  try {
    const noTok = new MockAgent(srv.url, null, 'x');
    const r1 = await noTok.rpc('tools/list', {});
    assert.equal(r1.status, 401);

    const badTok = new MockAgent(srv.url, 'deadbeef', 'x');
    const r2 = await badTok.rpc('tools/list', {});
    assert.equal(r2.status, 401);

    // health needs no auth
    const health = await fetch(srv.url.replace('/mcp', '/health'));
    assert.equal(health.status, 200);
  } finally {
    await srv.close();
  }
});

test('initialize + tools/list expose the catalog', async () => {
  const srv = await startTestServer();
  try {
    const a = new MockAgent(srv.url, srv.token, 'x');
    const init = await a.rpc('initialize', {});
    assert.equal(init.body.result.serverInfo.name, 'contex');
    const list = await a.rpc('tools/list', {});
    const names = list.body.result.tools.map((t) => t.name);
    assert.ok(names.includes('peer_set_state'));
    assert.ok(names.includes('peer_get_state'));
  } finally {
    await srv.close();
  }
});

test('idempotency_key makes a repeated mutation a no-op', async () => {
  const srv = await startTestServer();
  try {
    const a = new MockAgent(srv.url, srv.token, 'term-a');
    const first = await a.setState({ tile_type: 'terminal', status: 'idle', idempotency_key: 'k1' });
    const replay = await a.setState({ tile_type: 'terminal', status: 'idle', idempotency_key: 'k1' });
    assert.equal(first.data.version, 1);
    assert.equal(replay.data.version, 1); // cached, not re-applied to v2

    // a fresh call (no key) does advance the version
    const advanced = await a.setState({ status: 'working' });
    assert.equal(advanced.data.version, 2);
  } finally {
    await srv.close();
  }
});

test('business errors come back as MCP isError results, not transport failures', async () => {
  const srv = await startTestServer();
  try {
    const a = new MockAgent(srv.url, srv.token, 'ghost');
    const res = await a.getState(); // unknown tile
    assert.equal(res.isError, true);
    assert.equal(res.data.error.code, 'CONTEXT_TILE_NOT_FOUND');
  } finally {
    await srv.close();
  }
});
