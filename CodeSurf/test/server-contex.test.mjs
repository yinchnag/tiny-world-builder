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
  const ctx = await fetch(base + '/api/contex/context/a');
  assert.equal(ctx.status, 503);
  const view = await fetch(base + '/api/contex/status-view');
  assert.equal(view.status, 503);
  const timeline = await fetch(base + '/api/contex/timeline');
  assert.equal(timeline.status, 503);
  const attention = await fetch(base + '/api/contex/human-attention');
  assert.equal(attention.status, 503);
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
    body: JSON.stringify({ source: 'tile_a', target: 'tile_b', directed: true, kind: 'handoff' }),
  });
  assert.equal(r.status, 200);
  const link = linkCalls.find((c) => c[0] === 'link')[1];
  assert.equal(link.source_tile_id, 'tile_a');
  assert.equal(link.directed, true);
  assert.equal(link.kind, 'handoff');

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

test('Phase 7 context endpoints proxy objective, skills, attachments, and reload', async () => {
  const calls = [];
  const fixtureContext = {
    tile_id: 'tile_ctx',
    objective: { markdown: '# Build the tile', version: 3, reload_required: false },
    skills: [{ skill_key: 'tinyworld-integrations', enabled: true, source: 'repo' }],
    attachments: [{ kind: 'file', label: 'Plan', uri: 'file:///repo/PLAN.md' }],
  };
  const mock = await startMockMcp({ tools: {
    get_context: (a) => { calls.push(['get_context', a]); return fixtureContext; },
    set_objective: (a) => { calls.push(['set_objective', a]); return { version: 4, reload_required: true }; },
    set_skill: (a) => { calls.push(['set_skill', a]); return { skill_key: a.skill_key, enabled: a.enabled }; },
    add_context_attachment: (a) => { calls.push(['add_context_attachment', a]); return { id: 'att_1', ...a }; },
    reload_objective: (a) => { calls.push(['reload_objective', a]); return { acknowledged: true, tile_id: a.tile_id }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_1' });
  const store = new WorkspaceStore(tmp('cs-ctx-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  let r = await fetch(`${base}/api/contex/context/tile_ctx`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).context, fixtureContext);

  r = await fetch(`${base}/api/contex/context/tile_ctx/objective`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown: '# New objective', rules: ['Use tests'], generated_by: 'human' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/context/tile_ctx/skills`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_key: 'tinyworld-integrations', enabled: false, source: 'repo' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/context/tile_ctx/attachments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'file', label: 'Dev plan', uri: 'file:///repo/DEV.md', content_hash: 'sha256:abc' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/context/tile_ctx/reload`, { method: 'POST' });
  assert.equal(r.status, 200);

  assert.deepEqual(calls.map((c) => c[0]), [
    'get_context',
    'set_objective',
    'set_skill',
    'add_context_attachment',
    'reload_objective',
  ]);
  assert.deepEqual(calls[1][1], {
    tile_id: 'tile_ctx',
    markdown: '# New objective',
    rules: ['Use tests'],
    generated_by: 'human',
  });
  assert.equal(calls[2][1].enabled, false);
  assert.equal(calls[3][1].content_hash, 'sha256:abc');
  assert.equal(calls[4][1].tile_id, 'tile_ctx');

  server.close();
  await conn.stop();
  await mock.close();
});

test('Phase 8 status view proxies tasks, peers, file claims, and task/claim actions', async () => {
  const calls = [];
  const mock = await startMockMcp({ tools: {
    list_peers: (a) => { calls.push(['list_peers', a]); return { peers: [{ tile_id: 'agent_1', status: 'working' }] }; },
    list_tasks: (a) => { calls.push(['list_tasks', a]); return { tasks: [
      { id: 'task_1', title: 'Patch server', status: 'working', tile_id: 'agent_1' },
      {
        id: 'task_p1',
        channel: 'polly:abc123',
        title: 'Ship Polly view',
        status: 'paused',
        owner_tile_id: 'polly:abc123:item:p1',
        result_summary: 'Polly READY_FOR_HUMAN_MERGE · PR #42 · polly/p1-view',
      },
    ] }; },
    list_file_claims: (a) => { calls.push(['list_file_claims', a]); return { claims: [
      { id: 'claim_1', path: 'src/server.mjs', tile_id: 'agent_1', conflict: true },
      { id: 'claim_p1', path: '.worktrees/p1-view', tile_id: 'polly:abc123:item:p1', mode: 'edit' },
    ] }; },
    update_task: (a) => { calls.push(['update_task', a]); return { id: a.task_id, status: a.status }; },
    release_file_claim: (a) => { calls.push(['release_file_claim', a]); return { released: true, path: a.path }; },
    polly_request_action: (a) => { calls.push(['polly_request_action', a]); return { ok: true, request_id: 'pollyreq_1', ...a }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_8' });
  const store = new WorkspaceStore(tmp('cs-p8-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  let r = await fetch(`${base}/api/contex/status-view`);
  assert.equal(r.status, 200);
  const view = await r.json();
  assert.equal(view.peers[0].tile_id, 'agent_1');
  assert.equal(view.tasks[0].id, 'task_1');
  assert.equal(view.claims[0].path, 'src/server.mjs');
  assert.equal(view.polly.registries[0].registry_hash, 'abc123');
  assert.equal(view.polly.registries[0].ready, 1);
  assert.equal(view.polly.items[0].item_id, 'p1');
  assert.equal(view.polly.items[0].polly_status, 'READY_FOR_HUMAN_MERGE');
  assert.equal(view.polly.items[0].claims[0].path, '.worktrees/p1-view');
  assert.deepEqual(view.partial, []);

  r = await fetch(`${base}/api/contex/tasks/task_1/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'blocked', tile_id: 'agent_1', note: 'Need human review' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/claims/release`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claim_id: 'claim_1', path: 'src/server.mjs', tile_id: 'agent_1' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/polly/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ registry_hash: 'abc123', item_id: 'p1', action: 'rerun_gates', reason: 'Fresh gates please' }),
  });
  assert.equal(r.status, 200);

  assert.deepEqual(new Set(calls.map((c) => c[0])), new Set([
    'list_peers',
    'list_tasks',
    'list_file_claims',
    'update_task',
    'release_file_claim',
    'polly_request_action',
  ]));
  assert.equal(calls.find((c) => c[0] === 'list_peers')[1].workspace_id, 'ws_8');
  assert.deepEqual(calls.find((c) => c[0] === 'update_task')[1], {
    workspace_id: 'ws_8',
    task_id: 'task_1',
    status: 'blocked',
    tile_id: 'agent_1',
    note: 'Need human review',
  });
  assert.equal(calls.find((c) => c[0] === 'release_file_claim')[1].claim_id, 'claim_1');
  assert.deepEqual(calls.find((c) => c[0] === 'polly_request_action')[1], {
    workspace_id: 'ws_8',
    registry_path: '',
    registry_hash: 'abc123',
    item_id: 'p1',
    action: 'rerun_gates',
    reason: 'Fresh gates please',
    payload: {},
    requested_by_tile_id: '',
  });

  server.close();
  await conn.stop();
  await mock.close();
});

test('Phase 8 status view reports partial tool failures without failing the whole panel', async () => {
  const mock = await startMockMcp({ tools: {
    list_peers: () => ({ peers: [] }),
    list_tasks: () => { throw new Error('tasks unavailable'); },
    list_file_claims: () => ({ claims: [{ path: 'public/canvas.js', stale: true }] }),
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_8' });
  const store = new WorkspaceStore(tmp('cs-p8-partial-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  const r = await fetch(`${base}/api/contex/status-view`);
  assert.equal(r.status, 200);
  const view = await r.json();
  assert.deepEqual(view.tasks, []);
  assert.equal(view.claims[0].path, 'public/canvas.js');
  assert.equal(view.partial[0].tool, 'list_tasks');
  assert.match(view.partial[0].message, /tasks unavailable/);

  server.close();
  await conn.stop();
  await mock.close();
});

test('Phase 8 status view falls back to agent_list when list_peers is unavailable', async (t) => {
  const calls = [];
  const mock = await startMockMcp({ tools: {
    agent_list: (a) => { calls.push(['agent_list', a]); return { agents: [{ agent_id: 'live_agent', role: 'worker', status: 'working' }] }; },
    list_tasks: () => ({ tasks: [] }),
    list_file_claims: () => ({ claims: [] }),
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_realish' });
  const store = new WorkspaceStore(tmp('cs-p8-fallback-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  t.after(async () => {
    server.close();
    await conn.stop();
    await mock.close();
  });
  const base = url.replace(/\/$/, '');

  const r = await fetch(`${base}/api/contex/status-view`);
  assert.equal(r.status, 200);
  const view = await r.json();
  assert.equal(view.peers[0].agent_id, 'live_agent');
  assert.equal(view.partial.length, 0);
  assert.deepEqual(calls[0], ['agent_list', { workspace_id: 'ws_realish' }]);
});

test('Phase A timeline endpoints proxy workspace and Agent timelines', async () => {
  const calls = [];
  const workspaceEvents = [
    {
      sequence: 7,
      created_at: '2026-06-28T01:00:00Z',
      category: 'task',
      event_type: 'task_created',
      actor_id: 'coordinator',
      tile_id: 'coordinator',
      summary: 'Task created: Build timeline UI',
    },
  ];
  const agentEvents = [
    {
      sequence: 8,
      created_at: '2026-06-28T01:02:00Z',
      category: 'message',
      event_type: 'message_sent',
      actor_id: 'agent_1',
      tile_id: 'agent_1',
      summary: 'agent_1 -> reviewer',
    },
  ];
  const mock = await startMockMcp({ tools: {
    get_workspace_timeline: (a) => { calls.push(['get_workspace_timeline', a]); return { workspace_id: a.workspace_id, events: workspaceEvents, event_count: workspaceEvents.length }; },
    get_agent_timeline: (a) => { calls.push(['get_agent_timeline', a]); return { workspace_id: a.workspace_id, tile_id: a.tile_id, events: agentEvents, event_count: agentEvents.length }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_timeline' });
  const store = new WorkspaceStore(tmp('cs-timeline-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  const base = url.replace(/\/$/, '');

  let r = await fetch(`${base}/api/contex/timeline?since_sequence=5&limit=10`);
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.equal(body.workspace_id, 'ws_timeline');
  assert.equal(body.event_count, 1);
  assert.equal(body.events[0].summary, 'Task created: Build timeline UI');

  r = await fetch(`${base}/api/contex/timeline/agent_1?limit=20`);
  assert.equal(r.status, 200);
  body = await r.json();
  assert.equal(body.tile_id, 'agent_1');
  assert.equal(body.events[0].category, 'message');

  assert.deepEqual(calls[0], ['get_workspace_timeline', {
    workspace_id: 'ws_timeline',
    since_sequence: 5,
    limit: 10,
  }]);
  assert.deepEqual(calls[1], ['get_agent_timeline', {
    workspace_id: 'ws_timeline',
    since_sequence: 0,
    limit: 20,
    tile_id: 'agent_1',
    agent_id: 'agent_1',
  }]);

  server.close();
  await conn.stop();
  await mock.close();
});

test('Phase B human attention endpoints list pending agents and handle replies', async (t) => {
  const calls = [];
  const mock = await startMockMcp({ tools: {
    agent_list: (a) => {
      calls.push(['agent_list', a]);
      if (a.status === 'blocked') return { agents: [
        { agent_id: 'agent_1', tile_id: 'agent_1', status: 'blocked', role: 'worker', runtime: 'codex', blocker: 'May I edit protected files?', task: 'Patch UI' },
      ] };
      if (a.status === 'waiting') return { agents: [
        { agent_id: 'agent_2', tile_id: 'agent_2', status: 'waiting', role: 'reviewer', runtime: 'codex', summary: 'Waiting for approval.' },
      ] };
      return { agents: [] };
    },
    agent_send_message: (a) => { calls.push(['agent_send_message', a]); return { id: 'msg_1', ...a }; },
    agent_update_state: (a) => { calls.push(['agent_update_state', a]); return { agent_id: a.agent_id, status: a.status, blocker: a.blocker }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_human' });
  const store = new WorkspaceStore(tmp('cs-human-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  t.after(async () => {
    server.close();
    await conn.stop();
    await mock.close();
  });
  const base = url.replace(/\/$/, '');

  let r = await fetch(`${base}/api/contex/human-attention`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.attention.length, 2);
  assert.equal(body.attention[0].text, 'May I edit protected files?');
  assert.equal(body.attention[1].status, 'waiting');

  r = await fetch(`${base}/api/contex/human-attention/agent_1/reply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Approved for files inside the repo.' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/human-attention/agent_2/reject`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Do not continue.' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/human-attention/agent_1/handled`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'idle' }),
  });
  assert.equal(r.status, 200);

  assert.deepEqual(new Set(calls.filter((c) => c[0] === 'agent_list').map((c) => c[1].status)), new Set(['blocked', 'waiting']));
  assert.deepEqual(calls.find((c) => c[0] === 'agent_send_message')[1], {
    from_agent_id: 'human',
    to_agent_id: 'agent_1',
    text: 'Approved for files inside the repo.',
    priority: 'normal',
    requires_ack: false,
  });
  assert.equal(calls.filter((c) => c[0] === 'agent_update_state')[0][1].status, 'working');
  assert.equal(calls.filter((c) => c[0] === 'agent_update_state')[0][1].blocker, '');
  assert.equal(calls.filter((c) => c[0] === 'agent_update_state')[1][1].status, 'blocked');
  assert.equal(calls.filter((c) => c[0] === 'agent_update_state')[1][1].blocker, 'Do not continue.');
  assert.equal(calls.filter((c) => c[0] === 'agent_update_state')[2][1].status, 'idle');
});

test('Phase C agent action endpoints proxy collaboration tools', async (t) => {
  const calls = [];
  const mock = await startMockMcp({ tools: {
    agent_claim_task: (a) => { calls.push(['agent_claim_task', a]); return { id: a.task_id, owner_tile_id: a.agent_id, status: a.status }; },
    agent_complete_task: (a) => { calls.push(['agent_complete_task', a]); return { id: a.task_id, status: 'done', result_summary: a.result_summary }; },
    agent_request_handoff: (a) => { calls.push(['agent_request_handoff', a]); return { ok: true, message: { to_tile_id: a.to_agent_id, text: a.text } }; },
    agent_report: (a) => { calls.push(['agent_report', a]); return { ok: true, message: { to_tile_id: a.to_agent_id, text: a.text } }; },
    agent_broadcast: (a) => { calls.push(['agent_broadcast', a]); return { delivered: 1, failed: 1, selector: a.selector }; },
    canvas_next_commands: () => ({ commands: [] }),
  } });
  const conn = new ContexConnection({ drainIntervalMs: 10_000 });
  await conn.connectDirect({ url: mock.url, token: 'tok-a', workspace_id: 'ws_actions' });
  const store = new WorkspaceStore(tmp('cs-actions-'));
  const { server, url } = await startServer({ store, contex: conn, port: 0 });
  t.after(async () => {
    server.close();
    await conn.stop();
    await mock.close();
  });
  const base = url.replace(/\/$/, '');

  let r = await fetch(`${base}/api/contex/agent-actions/agent_a/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_id: 'task_1' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/agent-actions/agent_a/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_id: 'task_1', text: 'Done and tested.' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/agent-actions/agent_a/handoff`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to_agent_id: 'reviewer', task_id: 'task_1', text: 'Please review.' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/agent-actions/reviewer/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to_agent_id: 'coordinator', task_id: 'task_1', text: 'Approved.', result_summary: 'Review passed.' }),
  });
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/contex/agent-actions/coordinator/broadcast`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'worker', text: 'Workers, stand by.' }),
  });
  assert.equal(r.status, 200);

  assert.deepEqual(calls.map((c) => c[0]), [
    'agent_claim_task',
    'agent_complete_task',
    'agent_request_handoff',
    'agent_report',
    'agent_broadcast',
  ]);
  assert.deepEqual(calls[0][1], { agent_id: 'agent_a', task_id: 'task_1', status: 'in_progress' });
  assert.equal(calls[1][1].result_summary, 'Done and tested.');
  assert.equal(calls[2][1].to_agent_id, 'reviewer');
  assert.equal(calls[2][1].requires_ack, true);
  assert.equal(calls[3][1].to_agent_id, 'coordinator');
  assert.deepEqual(calls[4][1], {
    from_agent_id: 'coordinator',
    text: 'Workers, stand by.',
    selector: { role: 'worker' },
  });
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
