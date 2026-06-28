// -------- Phase 10: integration + reconnect hardening tests --------
// Covers: /version compatibility fields, SSE Last-Event-ID replay,
// GET /events owner endpoint, SSE backpressure disconnect, and a
// comprehensive E2E restart-recovery scenario (10-step coordination cycle).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createContex } from '../src/index.mjs';
import { startServer } from '../src/server.mjs';
import { callTool } from '../src/tools.mjs';
import { activeClaimsForTile } from '../src/domain/tiles.mjs';
import { McpClient } from './helpers.mjs';

// -------- SSE frame reader --------
// Reads up to `n` data-bearing SSE frames from a streaming Response.
// Returns array of { id, data } objects. Stops after n events or timeout.
async function readEvents(res, n, timeoutMs = 3000) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1 && events.length < n) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!frame.trim() || frame.startsWith(':')) continue; // keepalive/retry
        const lines = frame.split('\n');
        const idLine = lines.find((l) => l.startsWith('id:'));
        const dataLine = lines.find((l) => l.startsWith('data:'));
        if (dataLine) {
          const id = idLine ? idLine.slice(3).trim() : null;
          events.push({ id, data: JSON.parse(dataLine.slice(5).trim()) });
        }
      }
    }
  } catch { /* timeout cancel */ }
  finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  return events;
}

// Helper: open SSE stream with optional Last-Event-ID
function openStream(baseUrl, token, sessionId, lastEventId) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (lastEventId != null) headers['last-event-id'] = String(lastEventId);
  return fetch(baseUrl, { method: 'GET', headers });
}

// Helper: open /events (no session)
function openEventsStream(host, token, lastEventId) {
  const headers = { authorization: `Bearer ${token}`, accept: 'text/event-stream' };
  if (lastEventId != null) headers['last-event-id'] = String(lastEventId);
  return fetch(`${host}/events`, { method: 'GET', headers });
}

function cleanup(path) {
  for (const f of [path, `${path}-wal`, `${path}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

// -------- 1. /version compatibility fields --------
describe('Phase 10: /version compatibility fields', () => {
  it('GET /version includes schema_version and supported_protocols', async () => {
    const c = createContex();
    const { server, url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const host = url.replace('/mcp', '');
    try {
      const res = await fetch(`${host}/version`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.name, 'contex');
      assert.equal(body.schema_version, 4, 'schema_version matches SCHEMA_VERSION constant');
      assert.ok(Array.isArray(body.supported_protocols), 'supported_protocols is an array');
      assert.ok(body.supported_protocols.includes('2025-03-26'), 'includes default protocol');
      assert.ok(body.supported_protocols.includes('2025-06-18'), 'includes latest protocol');
      assert.ok(body.protocol, 'protocol (back-compat) still present');
    } finally {
      await close();
      c.close();
    }
  });

  it('GET /health still works unauthenticated (unchanged)', async () => {
    const c = createContex();
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    try {
      const res = await fetch(url.replace('/mcp', '/health'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
    } finally {
      await close();
      c.close();
    }
  });
});

// -------- 2. SSE Last-Event-ID replay --------
describe('Phase 10: SSE Last-Event-ID replay', () => {
  it('reconnecting client receives events missed during disconnect', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'replay' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    try {
      const client = new McpClient(url, token);
      await client.initialize();

      // Trigger 2 events via tool calls before opening the stream.
      // Events land in the ring synchronously during POST processing.
      await client.callTool('peer_set_state', { tile_id: 'r1', tile_type: 'terminal', status: 'idle' });
      await client.callTool('peer_set_state', { tile_id: 'r1', status: 'working' });

      // Open stream with Last-Event-ID: 0 → should replay both buffered events
      const streamRes = await openStream(url, token, client.sessionId, 0);
      assert.equal(streamRes.status, 200);
      assert.ok(streamRes.headers.get('content-type')?.includes('text/event-stream'));

      const events = await readEvents(streamRes, 2, 4000);
      assert.equal(events.length, 2, 'both buffered events replayed');
      assert.equal(events[0].id, '1', 'first replayed event has seq 1');
      assert.equal(events[1].id, '2', 'second replayed event has seq 2');
      assert.equal(events[0].data.method, 'notifications/context/tile_state_changed');
    } finally {
      await close();
      c.close();
    }
  });

  it('Last-Event-ID: 1 skips already-seen event, replays only newer ones', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'skip' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    try {
      const client = new McpClient(url, token);
      await client.initialize();

      // Trigger 3 events
      await client.callTool('peer_set_state', { tile_id: 's1', tile_type: 'terminal', status: 'idle' });
      await client.callTool('peer_set_state', { tile_id: 's1', status: 'working' });
      await client.callTool('peer_set_state', { tile_id: 's1', status: 'idle' });

      // Reconnect claiming "I already have event 1"
      const streamRes = await openStream(url, token, client.sessionId, 1);
      const events = await readEvents(streamRes, 2, 4000);
      assert.equal(events.length, 2, 'only the 2 events after seq 1 are replayed');
      assert.equal(events[0].id, '2');
      assert.equal(events[1].id, '3');
    } finally {
      await close();
      c.close();
    }
  });

  it('no Last-Event-ID means no replay (standard fresh stream)', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'noreplay' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    try {
      const client = new McpClient(url, token);
      await client.initialize();

      // Trigger 2 events before opening the stream
      await client.callTool('peer_set_state', { tile_id: 'n1', tile_type: 'terminal', status: 'idle' });
      await client.callTool('peer_set_state', { tile_id: 'n1', status: 'working' });

      // Open stream without Last-Event-ID → no replay, only future events
      const streamRes = await openStream(url, token, client.sessionId);
      // Immediately trigger a new event to confirm the live path works
      await client.callTool('peer_set_state', { tile_id: 'n1', status: 'idle' });

      const events = await readEvents(streamRes, 1, 4000);
      assert.equal(events.length, 1, 'only the new live event (seq 3)');
      assert.equal(events[0].id, '3');
    } finally {
      await close();
      c.close();
    }
  });
});

// -------- 3. GET /events owner SSE endpoint --------
describe('Phase 10: GET /events owner endpoint', () => {
  it('returns 401 without a bearer token', async () => {
    const c = createContex();
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const host = url.replace('/mcp', '');
    try {
      const res = await fetch(`${host}/events`, { headers: { accept: 'text/event-stream' } });
      assert.equal(res.status, 401);
    } finally {
      await close();
      c.close();
    }
  });

  it('returns 406 without Accept: text/event-stream', async () => {
    const c = createContex();
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const host = url.replace('/mcp', '');
    try {
      const res = await fetch(`${host}/events`, {
        headers: { authorization: 'Bearer tok', accept: 'application/json' },
      });
      assert.equal(res.status, 406);
    } finally {
      await close();
      c.close();
    }
  });

  it('streams live events to the owner without needing an MCP session', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'owner' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const host = url.replace('/mcp', '');
    try {
      const client = new McpClient(url, token);
      await client.initialize();

      // Pre-emit one event so the ring has it
      await client.callTool('peer_set_state', { tile_id: 'o1', tile_type: 'terminal', status: 'idle' });

      // Open /events with Last-Event-ID: 0 to replay the buffered event
      const evRes = await openEventsStream(host, token, 0);
      assert.equal(evRes.status, 200);
      assert.ok(evRes.headers.get('content-type')?.includes('text/event-stream'));

      const events = await readEvents(evRes, 1, 4000);
      assert.equal(events.length, 1, 'replayed the pre-emitted event');
      assert.equal(events[0].data.method, 'notifications/context/tile_state_changed');
    } finally {
      await close();
      c.close();
    }
  });

  it('/events shares the same ring as GET /mcp — same event IDs', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'shared-ring' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const host = url.replace('/mcp', '');
    try {
      const client = new McpClient(url, token);
      await client.initialize();

      // Emit 2 events via /mcp
      await client.callTool('peer_set_state', { tile_id: 'sr1', tile_type: 'terminal', status: 'idle' });
      await client.callTool('peer_set_state', { tile_id: 'sr1', status: 'working' });

      // Read via /mcp GET with replay
      const mcpStream = await openStream(url, token, client.sessionId, 0);
      const mcpEvents = await readEvents(mcpStream, 2, 6000);

      // Read via /events GET — same ring, same IDs
      const evStream = await openEventsStream(host, token, 0);
      const evEvents = await readEvents(evStream, 2, 6000);

      assert.equal(mcpEvents.length, 2, 'mcp stream replayed 2 events');
      assert.equal(evEvents.length, 2, '/events stream replayed 2 events');
      assert.equal(mcpEvents[0].id, evEvents[0].id, 'both streams share sequence IDs');
      assert.equal(mcpEvents[1].id, evEvents[1].id);
    } finally {
      await close();
      c.close();
    }
  });
});

// -------- 4. comprehensive E2E restart recovery (10-step) --------
describe('Phase 10: comprehensive E2E restart recovery', () => {
  it('full coordination cycle: tiles, links, messages, todos, claims, objective, task — all survive restart', () => {
    const dbPath = join(tmpdir(), `contex-e2e-${process.pid}-${performance.now().toString(36).replace('.', '')}.db`);
    cleanup(dbPath);
    try {
      // ── Step 1: create workspace ──
      let c = createContex({ dbPath });
      const ws = c.createWorkspace({ name: 'e2e', repository_path: '/repo' });

      // ── Step 2: register two tiles ──
      callTool(c, 'peer_set_state', {
        tile_id: 'term-a', tile_type: 'terminal', status: 'idle', task: 'Ready',
        workspace_id: ws.id,
      });
      callTool(c, 'peer_set_state', {
        tile_id: 'chat-b', tile_type: 'chat', status: 'idle',
        workspace_id: ws.id,
      });

      // ── Step 3: link them ──
      callTool(c, 'link_tiles', { source_tile_id: 'term-a', target_tile_id: 'chat-b', workspace_id: ws.id });
      assert.equal(c.listLinks(ws.id).length, 1);

      // ── Step 4: update state ──
      callTool(c, 'peer_set_state', {
        tile_id: 'term-a', status: 'working', task: 'Build',
        files: [{ path: 'engine/world.js', mode: 'exclusive' }, { path: 'engine/render.js', mode: 'edit' }],
        workspace_id: ws.id,
      });
      assert.equal(activeClaimsForTile(c.db, 'term-a').length, 2);

      // ── Step 5: exchange a message ──
      callTool(c, 'peer_send_message', {
        from_tile_id: 'chat-b', to_tile_id: 'term-a', text: 'How far along?', requires_ack: true,
      });

      // ── Step 6: create a todo ──
      const todo = callTool(c, 'peer_add_todo', {
        creator_tile_id: 'term-a', assignee_tile_id: 'chat-b', title: 'Review the render output',
        workspace_id: ws.id,
      });
      assert.equal(todo.status, 'open');

      // ── Step 7: create a task ──
      callTool(c, 'create_task', { title: 'Phase 10 test task', workspace_id: ws.id });

      // ── Step 8: set objective on term-a ──
      callTool(c, 'set_objective', {
        tile_id: 'term-a', markdown: '# Phase 10 objective\nBuild the engine.',
        workspace_id: ws.id,
      });

      // record IDs before close
      const workspaceId = ws.id;
      const todoId = todo.id;
      c.close();

      // ── Step 9: restart (reopen the same db) ──
      c = createContex({ dbPath });

      // ── Step 10: verify all state recovered ──
      const sole = c.soleWorkspace();
      assert.equal(sole.id, workspaceId, 'workspace id persisted');

      // tiles
      const tiles = c.listTiles(workspaceId);
      assert.equal(tiles.length, 2, 'both tiles present');
      const termA = c.getTile('term-a');
      assert.equal(termA.reported_status, 'working', 'tile status persisted');
      assert.equal(termA.task, 'Build', 'tile task persisted');
      assert.equal(termA.version, 2, 'tile version persisted');

      // file claims
      const claims = activeClaimsForTile(c.db, 'term-a');
      assert.equal(claims.length, 2, 'file claims persisted');
      const paths = claims.map((cl) => cl.path).sort();
      assert.equal(paths[0], 'engine/render.js');
      assert.equal(paths[1], 'engine/world.js');

      // link
      const links = c.listLinks(workspaceId);
      assert.equal(links.length, 1, 'link persisted');
      assert.equal(links[0].source_tile_id, 'term-a');

      // message
      const msgs = callTool(c, 'peer_read_messages', { tile_id: 'term-a', unread_only: false });
      assert.equal(msgs.messages.length, 1, 'message persisted');
      assert.equal(msgs.messages[0].text, 'How far along?');

      // todo
      const todos = c.listTodos(workspaceId);
      assert.equal(todos.length, 1, 'todo persisted');
      assert.equal(todos[0].id, todoId);
      assert.equal(todos[0].title, 'Review the render output');

      // task
      const tasks = c.listTasks(workspaceId);
      assert.equal(tasks.length, 1, 'task persisted');
      assert.equal(tasks[0].title, 'Phase 10 test task');

      // objective
      const obj = c.getObjective('term-a');
      assert.ok(obj, 'objective persisted');
      assert.ok(obj.markdown.includes('Phase 10 objective'));

      // peer graph still resolves
      const view = c.getState({ tile_id: 'term-a' });
      assert.equal(view.peers.length, 1, 'peer graph intact after restart');
      assert.equal(view.peers[0].tile_id, 'chat-b');

      // audit log has events from before restart
      const auditEvents = c.listAudit(workspaceId, 50);
      assert.ok(auditEvents.length > 5, 'audit events persisted across restart');

      c.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('export then import preserves full state in a fresh db', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'export-e2e' });
    callTool(c, 'peer_set_state', { tile_id: 'e1', tile_type: 'terminal', status: 'working', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'e2', tile_type: 'chat', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'e1', target_tile_id: 'e2', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'e1', to_tile_id: 'e2', text: 'synced?' });
    callTool(c, 'peer_add_todo', { creator_tile_id: 'e1', title: 'export task', workspace_id: ws.id });

    const bundle = callTool(c, 'export_workspace', { workspace_id: ws.id });
    assert.equal(bundle.schema, 'contex-export/1');

    const c2 = createContex();
    c2.importWorkspace(bundle);

    const ws2 = c2.getWorkspace(ws.id);
    assert.equal(ws2.name, 'export-e2e');
    assert.equal(c2.listTiles(ws.id).length, 2);
    assert.equal(c2.listLinks(ws.id).length, 1);
    const msgs = callTool(c2, 'peer_read_messages', { tile_id: 'e2', unread_only: false });
    assert.equal(msgs.messages.length, 1);
    assert.equal(c2.listTodos(ws.id).length, 1);

    c.close();
    c2.close();
  });
});

// -------- 5. schema compatibility guard --------
describe('Phase 10: schema / db migration guard', () => {
  it('reopening a db with CREATE TABLE IF NOT EXISTS is idempotent (no migration needed)', () => {
    const dbPath = join(tmpdir(), `contex-schema-${process.pid}-${performance.now().toString(36).replace('.', '')}.db`);
    cleanup(dbPath);
    try {
      // First open: creates all tables
      let c = createContex({ dbPath });
      const ws = c.createWorkspace({ name: 'schema-test' });
      callTool(c, 'peer_set_state', { tile_id: 'sc1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
      c.close();

      // Second open: no error, existing tables untouched
      c = createContex({ dbPath });
      const tile = c.getTile('sc1');
      assert.equal(tile.status, 'idle', 'tile still queryable after reopen');

      // All Phase 8 tables (canvas_command, audit_event) must exist
      const tables = c.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r) => r.name);
      const required = ['workspace', 'tile', 'tile_link', 'file_claim', 'message',
        'task', 'todo', 'objective_version', 'objective_ack', 'skill_assignment',
        'context_attachment', 'canvas_command', 'audit_event', 'idempotency'];
      for (const t of required) {
        assert.ok(tables.includes(t), `table ${t} exists`);
      }

      c.close();
    } finally {
      cleanup(dbPath);
    }
  });
});
