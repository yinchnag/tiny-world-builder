import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { startServer } from '../src/server.mjs';
import { createToken } from '../src/auth.mjs';
import { McpClient, waitForNotification } from './helpers.mjs';

async function startTestServer() {
  const contex = createContex();
  contex.createWorkspace({ name: 'test', repository_path: '/repo' });
  const token = createToken();
  const srv = await startServer({ contex, token });
  return { ...srv, contex, close: async () => { await srv.close(); contex.close(); } };
}

test('initialize handshake mints a session and negotiates protocol', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    const init = await c.initialize();
    assert.equal(init.status, 200);
    assert.ok(init.sessionId, 'server returned Mcp-Session-Id');
    assert.equal(init.body.result.serverInfo.name, 'contex');
    assert.equal(init.body.result.protocolVersion, '2025-03-26');
  } finally {
    await srv.close();
  }
});

test('notifications/initialized returns 202 with no body', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.post('initialize', { protocolVersion: '2025-03-26' });
    const ack = await c.post('notifications/initialized', {});
    assert.equal(ack.status, 202);
    assert.equal(ack.body, null);
  } finally {
    await srv.close();
  }
});

test('server pushes a notification onto the GET SSE stream', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();

    // open the server->client stream first so the listener is attached
    const stream = await c.openStream();
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);

    // trigger a state change from another client; the stream should receive it
    const trigger = new McpClient(srv.url, srv.token);
    await trigger.initialize();
    const fire = trigger.callTool('peer_set_state', { tile_id: 'tile-1', tile_type: 'terminal', status: 'idle' });

    const note = await waitForNotification(stream, (m) => m.method === 'notifications/context/tile_state_changed');
    await fire;
    assert.ok(note, 'received a tile_state_changed notification');
    assert.equal(note.params.tile_id, 'tile-1');
  } finally {
    await srv.close();
  }
});

test('linking tiles pushes a peer_link_changed notification', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    await c.callTool('peer_set_state', { tile_id: 'a', tile_type: 'terminal', status: 'idle' });
    await c.callTool('peer_set_state', { tile_id: 'b', tile_type: 'chat', status: 'idle' });

    const stream = await c.openStream();
    const trigger = new McpClient(srv.url, srv.token);
    await trigger.initialize();
    const fire = trigger.callTool('link_tiles', { source_tile_id: 'a', target_tile_id: 'b' });

    const note = await waitForNotification(stream, (m) => m.method === 'notifications/context/peer_link_changed');
    await fire;
    assert.ok(note, 'received a peer_link_changed notification');
    assert.equal(note.params.action, 'created');
  } finally {
    await srv.close();
  }
});

test('notify human_attention reaches the SSE stream', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    const stream = await c.openStream();

    const trigger = new McpClient(srv.url, srv.token);
    await trigger.initialize();
    const fire = trigger.callTool('notify', { text: 'a human is needed', level: 'human_attention' });

    const note = await waitForNotification(stream, (m) => m.method === 'notifications/context/human_attention');
    await fire;
    assert.ok(note, 'received a human_attention notification');
    assert.equal(note.params.text, 'a human is needed');
  } finally {
    await srv.close();
  }
});

test('terminal asks a linked chat tile and reads the reply (Phase 4 exit)', async () => {
  const srv = await startTestServer();
  try {
    const term = new McpClient(srv.url, srv.token);
    const chat = new McpClient(srv.url, srv.token);
    await term.initialize();
    await chat.initialize();
    await term.callTool('peer_set_state', { tile_id: 'term', tile_type: 'terminal', status: 'working' });
    await chat.callTool('peer_set_state', { tile_id: 'chat', tile_type: 'chat', status: 'idle' });
    await term.callTool('link_tiles', { source_tile_id: 'term', target_tile_id: 'chat' });

    // terminal asks the chat tile a question
    await term.callTool('chat_send_message', { from_tile_id: 'term', to_tile_id: 'chat', text: 'Ship it?', requires_ack: true });
    const inbox = (await chat.callTool('peer_read_messages', { tile_id: 'chat' })).structuredContent.messages;
    assert.equal(inbox[0].text, 'Ship it?');
    // chat replies back (target is a terminal, so a peer message)
    await chat.callTool('peer_send_message', { from_tile_id: 'chat', to_tile_id: 'term', text: 'Yes, ship it.' });
    const reply = (await term.callTool('peer_read_messages', { tile_id: 'term' })).structuredContent.messages;
    assert.equal(reply[0].text, 'Yes, ship it.');
  } finally {
    await srv.close();
  }
});

test('create_task over MCP emits a task_changed notification', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    const stream = await c.openStream();

    const trigger = new McpClient(srv.url, srv.token);
    await trigger.initialize();
    const fire = trigger.callTool('create_task', { title: 'Build it', channel: 'term' });

    const note = await waitForNotification(stream, (m) => m.method === 'notifications/context/task_changed');
    const res = await fire;
    assert.equal(res.isError, false);
    assert.equal(res.structuredContent.status, 'open');
    assert.ok(note, 'received a task_changed notification');
    assert.equal(note.params.status, 'open');
  } finally {
    await srv.close();
  }
});

test('set_objective over MCP signals objective_reload_required (Phase 7 exit)', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    await c.callTool('peer_set_state', { tile_id: 'term', tile_type: 'terminal', status: 'working' });
    const stream = await c.openStream();

    // CodeSurf/owner alters the objective; the running agent is prompted to reload
    const owner = new McpClient(srv.url, srv.token);
    await owner.initialize();
    const fire = owner.callTool('set_objective', { tile_id: 'term', markdown: 'New plan' });

    const note = await waitForNotification(stream, (m) => m.method === 'notifications/context/objective_reload_required');
    await fire;
    assert.ok(note, 'received objective_reload_required');
    assert.equal(note.params.tile_id, 'term');

    // agent reloads and acknowledges
    const reloaded = (await c.callTool('reload_objective', { tile_id: 'term' })).structuredContent;
    assert.equal(reloaded.markdown, 'New plan');
    assert.equal(reloaded.reload_required, false);
  } finally {
    await srv.close();
  }
});

test('GET stream requires Accept: text/event-stream and a valid session', async () => {
  const srv = await startTestServer();
  try {
    // no session at all
    const noSession = await fetch(srv.url, { method: 'GET', headers: { authorization: `Bearer ${srv.token}`, accept: 'text/event-stream' } });
    assert.equal(noSession.status, 404);

    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    // valid session but wrong Accept
    const wrongAccept = await fetch(srv.url, { method: 'GET', headers: { authorization: `Bearer ${srv.token}`, accept: 'application/json', 'mcp-session-id': c.sessionId } });
    assert.equal(wrongAccept.status, 406);
  } finally {
    await srv.close();
  }
});

test('an unknown/expired session is rejected with 404', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    const r = await c.post('tools/list', {}, { sessionId: 'not-a-real-session' });
    assert.equal(r.status, 404);
  } finally {
    await srv.close();
  }
});

test('DELETE terminates the session', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    const del = await c.deleteSession();
    assert.equal(del.status, 200);
    // the session is gone now
    const after = await c.post('tools/list', {});
    assert.equal(after.status, 404);
  } finally {
    await srv.close();
  }
});

test('resources are advertised and read over MCP', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    const init = await c.initialize();
    assert.ok(init.body.result.capabilities.resources, 'resources capability advertised');
    await c.callTool('peer_set_state', { tile_id: 't', tile_type: 'terminal', status: 'idle' });

    const list = await c.listResources();
    assert.ok(list.body.result.resources.some((r) => r.uri === 'context://tile/t/state'));

    const read = await c.readResource('context://tile/t/state');
    const data = JSON.parse(read.body.result.contents[0].text);
    assert.equal(data.tile_id, 't');
    assert.equal(data.status, 'idle');
  } finally {
    await srv.close();
  }
});

test('a full client lifecycle: initialize -> list -> call -> delete', async () => {
  const srv = await startTestServer();
  try {
    const c = new McpClient(srv.url, srv.token);
    await c.initialize();
    const list = await c.post('tools/list', {});
    assert.ok(list.body.result.tools.some((t) => t.name === 'peer_set_state'));
    const call = await c.callTool('peer_set_state', { tile_id: 't', tile_type: 'terminal', status: 'idle' });
    assert.equal(call.isError, false);
    assert.equal(call.structuredContent.version, 1);
    const del = await c.deleteSession();
    assert.equal(del.status, 200);
  } finally {
    await srv.close();
  }
});
