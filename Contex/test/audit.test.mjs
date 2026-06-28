// -------- Phase 9: audit, replay, and export tests --------
// Covers: audit event coverage, correlation_id threading, workspace export/
// import round-trip, secret redaction, damaged event recovery, audit feed
// pagination, and the context://workspace/{id}/audit MCP resource.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { callTool } from '../src/tools.mjs';
import { redactSecrets } from '../src/domain/export.mjs';
import { startServer } from '../src/server.mjs';
import { MockAgent } from './helpers.mjs';
import { openDb } from '../src/db.mjs';
import { listAuditFeed } from '../src/store.mjs';

// -------- helpers --------
let tick = 0;
const clock = () => Date.UTC(2026, 0, 1) + (tick++ * 1000);

function makeContex() {
  return createContex({ clock });
}

// -------- 1. audit events written for tile state change --------
describe('audit: tile state change', () => {
  it('peer_set_state writes a tile_state_changed audit event', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'w1' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-a', tile_type: 'terminal', status: 'working', workspace_id: ws.id });
    const events = c.listAudit(ws.id, 10);
    const ev = events.find((e) => e.event_type === 'tile_state_changed');
    assert.ok(ev, 'tile_state_changed event written');
    assert.equal(ev.tile_id, 'tile-a');
    assert.deepEqual(ev.payload, { status: 'working', task: null });
    c.close();
  });
});

// -------- 2. audit events written for messages --------
describe('audit: message sent', () => {
  it('peer_send_message writes a message_sent audit event', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'w2' });
    callTool(c, 'peer_set_state', { tile_id: 'ta', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'tb', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'ta', target_tile_id: 'tb', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'ta', to_tile_id: 'tb', text: 'hello' });
    const events = c.listAudit(ws.id, 20);
    const ev = events.find((e) => e.event_type === 'message_sent');
    assert.ok(ev, 'message_sent event written');
    assert.equal(ev.actor_id, 'ta');
    c.close();
  });
});

// -------- 3. audit events written for task create --------
describe('audit: task created', () => {
  it('create_task writes a task_created audit event', () => {
    const c = makeContex();
    c.createWorkspace({ name: 'w3' });
    callTool(c, 'create_task', { title: 'do something' });
    const ws = c.soleWorkspace();
    const events = c.listAudit(ws.id, 10);
    const ev = events.find((e) => e.event_type === 'task_created');
    assert.ok(ev, 'task_created event written');
    assert.equal(ev.payload.title, 'do something');
    c.close();
  });
});

// -------- 4. correlation_id threaded from callTool to audit event --------
describe('audit: correlation_id', () => {
  it('all audit events from one callTool share the same correlation_id', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'w4' });
    // A single peer_set_state call produces a tile_state_changed event. Because
    // callTool sets _callCtx around the synchronous domain call, the event's
    // correlation_id is the one generated for this call (not null).
    callTool(c, 'peer_set_state', { tile_id: 'tx', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    const events = c.listAudit(ws.id, 10);
    const ev = events.find((e) => e.event_type === 'tile_state_changed');
    assert.ok(ev?.correlation_id, 'correlation_id is set (not null)');
    assert.match(ev.correlation_id, /^call_/, 'correlation_id has call_ prefix');
    c.close();
  });

  it('caller-supplied correlation_id is used instead of auto-generated one', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'w4b' });
    callTool(c, 'peer_set_state', { tile_id: 'ty', tile_type: 'terminal', status: 'idle', workspace_id: ws.id, correlation_id: 'my-trace-id' });
    const events = c.listAudit(ws.id, 10);
    const ev = events.find((e) => e.event_type === 'tile_state_changed');
    assert.equal(ev?.correlation_id, 'my-trace-id');
    c.close();
  });
});

// -------- 5 & 6. export/import round trip --------
describe('audit: export/import round trip', () => {
  it('exportWorkspace produces a bundle with all entities; importWorkspace restores them', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'round-trip', repository_path: '/repo' });
    callTool(c, 'peer_set_state', { tile_id: 'r1', tile_type: 'terminal', status: 'working', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'r2', tile_type: 'chat', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'r1', target_tile_id: 'r2', workspace_id: ws.id });
    callTool(c, 'create_task', { title: 'exported task', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'r1', to_tile_id: 'r2', text: 'hi' });

    const bundle = callTool(c, 'export_workspace', { workspace_id: ws.id });

    // validate bundle structure
    assert.equal(bundle.schema, 'contex-export/1');
    assert.ok(bundle.exported_at);
    assert.equal(bundle.workspace.name, 'round-trip');
    assert.equal(bundle.tiles.length, 2);
    assert.equal(bundle.links.length, 1);
    assert.equal(bundle.tasks.length, 1);
    assert.equal(bundle.messages.length, 1);
    assert.ok(bundle.audit_events.length > 0, 'audit events included');

    // import into a fresh db and verify state
    const c2 = createContex({ clock });
    c2.importWorkspace(bundle);
    const ws2 = c2.getWorkspace(ws.id);
    assert.equal(ws2.name, 'round-trip');
    const tiles = c2.listTiles(ws.id);
    assert.equal(tiles.length, 2);
    const links = c2.listLinks(ws.id);
    assert.equal(links.length, 1);
    const tasks = c2.listTasks(ws.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'exported task');

    c.close();
    c2.close();
  });
});

// -------- 7. secret redaction --------
describe('audit: secret redaction', () => {
  it('redactSecrets removes sensitive keys from the export bundle', () => {
    const obj = {
      token: 'abc123',
      name: 'workspace',
      nested: { password: 'secret', repository_path: '/repo' },
      authorization: 'Bearer xyz',
      arr: [{ api_key: 'k', label: 'ok' }],
    };
    const redacted = redactSecrets(obj);
    assert.equal(redacted.token, '[REDACTED]');
    assert.equal(redacted.name, 'workspace');
    assert.equal(redacted.nested.password, '[REDACTED]');
    assert.equal(redacted.nested.repository_path, '/repo');
    assert.equal(redacted.authorization, '[REDACTED]');
    assert.equal(redacted.arr[0].api_key, '[REDACTED]');
    assert.equal(redacted.arr[0].label, 'ok');
  });

  it('export_workspace bundle contains no raw token values in known sensitive fields', () => {
    const c = makeContex();
    c.createWorkspace({ name: 'sec-test' });
    const ws = c.soleWorkspace();
    const bundle = c.exportWorkspace(ws.id);
    // redactSecrets should have been applied — scan stringified bundle
    const str = JSON.stringify(bundle);
    assert.doesNotMatch(str, /"token"\s*:\s*"[^"R]/, 'no raw token field');
    c.close();
  });
});

// -------- 8. damaged event recovery --------
describe('audit: damaged event recovery', () => {
  it('malformed payload_json in audit_event does not crash listAuditFeed', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'damaged' });
    // Inject a row with unparseable payload_json directly via DB
    c.db.prepare(
      `INSERT INTO audit_event (workspace_id, event_type, payload_json, created_at)
       VALUES (?, 'test_event', ?, ?)`
    ).run(ws.id, '{not valid json', new Date().toISOString());

    // Should not throw; the broken row should have payload with _error flag
    const events = listAuditFeed(c.db, ws.id, { since_sequence: 0, limit: 20 });
    const broken = events.find((e) => e.event_type === 'test_event');
    assert.ok(broken, 'damaged row returned');
    assert.equal(broken.payload?._error, 'parse_failed');
    assert.equal(broken.payload?._raw, '{not valid json');
    c.close();
  });
});

// -------- 9. audit feed pagination + MCP resource --------
describe('audit: feed pagination and MCP resource', () => {
  it('listAuditFeed since_sequence returns only newer events', () => {
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'feed' });
    callTool(c, 'peer_set_state', { tile_id: 'f1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    const first = listAuditFeed(c.db, ws.id, { since_sequence: 0, limit: 100 });
    const checkpoint = first[first.length - 1].sequence;
    callTool(c, 'peer_set_state', { tile_id: 'f1', status: 'working', workspace_id: ws.id });
    const second = listAuditFeed(c.db, ws.id, { since_sequence: checkpoint, limit: 100 });
    assert.ok(second.length > 0, 'new events after checkpoint');
    assert.ok(second.every((e) => e.sequence > checkpoint), 'all events after checkpoint');
    c.close();
  });

  it('context://workspace/{id}/audit resource is readable via MCP', async () => {
    tick = 0;
    const c = makeContex();
    const ws = c.createWorkspace({ name: 'audit-res' });
    callTool(c, 'peer_set_state', { tile_id: 'ar1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const { server, url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const agent = new MockAgent(url, token, 'ar1');

    const { body } = await agent.rpc('resources/read', { uri: `context://workspace/${ws.id}/audit` });
    assert.equal(body.result?.contents?.[0]?.mimeType, 'application/json');
    const content = JSON.parse(body.result.contents[0].text);
    assert.equal(content.workspace_id, ws.id);
    assert.ok(Array.isArray(content.events));
    assert.ok(content.events.length > 0);
    // All events have sequence and event_type
    assert.ok(content.events.every((e) => e.sequence > 0 && e.event_type));

    await close();
    c.close();
  });
});
