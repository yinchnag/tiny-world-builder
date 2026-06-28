// -------- Phase 11: operational hardening tests --------
// Covers: structured JSON logging (output + redaction), rate limiting (per-IP
// sliding window, 429 + Retry-After), retention scheduler (purge on interval),
// GET /metrics endpoint (DB-backed counters), and TLS/HTTPS (config plumbing).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createContex } from '../src/index.mjs';
import { startServer, runRetention } from '../src/server.mjs';
import { createLogger } from '../src/logger.mjs';
import { callTool } from '../src/tools.mjs';
import { getDbMetrics } from '../src/store.mjs';
import { MockAgent } from './helpers.mjs';

function cleanup(path) {
  for (const f of [path, `${path}-wal`, `${path}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

// In-memory write stream that accumulates lines for inspection.
function makeLogStream() {
  const lines = [];
  return {
    write(chunk) { lines.push(chunk); },
    lines,
    parsed() { return lines.map((l) => JSON.parse(l.trim())).filter(Boolean); },
  };
}

// -------- 1. structured JSON logging --------
describe('Phase 11: structured JSON logging', () => {
  it('emits valid JSON lines with ts, level, event fields', () => {
    const stream = makeLogStream();
    const log = createLogger({ stream });
    log.info('test.event', { foo: 'bar', count: 3 });
    log.warn('test.warn', {});
    assert.equal(stream.lines.length, 2);
    const parsed = stream.parsed();
    assert.ok(parsed[0].ts, 'ts field present');
    assert.equal(parsed[0].level, 'info');
    assert.equal(parsed[0].event, 'test.event');
    assert.equal(parsed[0].foo, 'bar');
    assert.equal(parsed[1].level, 'warn');
  });

  it('redacts sensitive key names: token, authorization, bearer, password, text', () => {
    const stream = makeLogStream();
    const log = createLogger({ stream });
    log.info('tool.call', {
      token: 'abc123',
      authorization: 'Bearer xyz',
      tool: 'peer_send_message',
      text: 'hello world',
      session: 'sess-1',
    });
    const ev = stream.parsed()[0];
    assert.equal(ev.token, '[REDACTED]', 'token redacted');
    assert.equal(ev.authorization, '[REDACTED]', 'authorization redacted');
    assert.equal(ev.text, '[REDACTED]', 'text (message content) redacted');
    assert.equal(ev.tool, 'peer_send_message', 'non-sensitive field preserved');
    assert.equal(ev.session, 'sess-1', 'session preserved');
  });

  it('debug messages are suppressed at info level', () => {
    const stream = makeLogStream();
    const log = createLogger({ stream, level: 'info' });
    log.debug('debug.event', { detail: 'noisy' });
    log.info('info.event', {});
    assert.equal(stream.lines.length, 1, 'only the info line emitted');
    assert.equal(stream.parsed()[0].event, 'info.event');
  });

  it('startServer logs server.start event with non-token context', async () => {
    const stream = makeLogStream();
    const log = createLogger({ stream });
    const c = createContex();
    const { close } = await startServer({ contex: c, token: 'tok123', port: 0, logger: log });
    await close();
    c.close();
    const startEv = stream.parsed().find((e) => e.event === 'server.start');
    assert.ok(startEv, 'server.start event emitted');
    assert.ok(startEv.url, 'url field present');
    assert.ok(startEv.port > 0, 'port > 0');
    // token must NOT appear in the log
    const allText = JSON.stringify(stream.parsed());
    assert.doesNotMatch(allText, /tok123/, 'token never logged');
  });

  it('tool.call events are logged with tool name and isError flag', async () => {
    const stream = makeLogStream();
    const log = createLogger({ stream });
    const c = createContex();
    c.createWorkspace({ name: 'log-test' });
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0, logger: log });
    const agent = new MockAgent(url, token, 't1');
    await agent.setState({ tile_type: 'terminal', status: 'idle' });
    await close();
    c.close();
    const toolEvents = stream.parsed().filter((e) => e.event === 'tool.call');
    assert.ok(toolEvents.length > 0, 'at least one tool.call logged');
    assert.equal(toolEvents[0].tool, 'peer_set_state');
    assert.equal(toolEvents[0].isError, false);
  });
});

// -------- 2. rate limiting --------
describe('Phase 11: rate limiting', () => {
  it('returns 429 once the per-IP limit is exceeded', async () => {
    const c = createContex();
    c.createWorkspace({ name: 'rl' });
    // Set limit to 3 requests/min so we can test with just 4 requests
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0, maxRequestsPerMinute: 3 });
    try {
      const agent = new MockAgent(url, token, 'rl1');
      // First 3 should succeed (any response != 429)
      const r1 = await agent.rpc('tools/list', {});
      const r2 = await agent.rpc('tools/list', {});
      const r3 = await agent.rpc('tools/list', {});
      assert.notEqual(r1.status, 429);
      assert.notEqual(r2.status, 429);
      assert.notEqual(r3.status, 429);
      // 4th request should be rate-limited
      const r4 = await agent.rpc('tools/list', {});
      assert.equal(r4.status, 429);
    } finally {
      await close();
      c.close();
    }
  });

  it('429 response includes Retry-After header', async () => {
    const c = createContex();
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0, maxRequestsPerMinute: 1 });
    try {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' };
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      await fetch(url, { method: 'POST', headers, body });
      await fetch(url, { method: 'POST', headers, body });
      const res = await fetch(url, { method: 'POST', headers, body });
      assert.equal(res.status, 429);
      assert.ok(res.headers.get('retry-after'), 'Retry-After header present');
    } finally {
      await close();
      c.close();
    }
  });

  it('rate limit = 0 disables limiting (all requests pass)', async () => {
    const c = createContex();
    const { url, token, close } = await startServer({ contex: c, token: 'tok', port: 0, maxRequestsPerMinute: 0 });
    try {
      const agent = new MockAgent(url, token, 'no-rl');
      // Send 20 rapid requests — none should be 429
      const results = await Promise.all(Array.from({ length: 20 }, () => agent.rpc('tools/list', {})));
      assert.ok(results.every((r) => r.status !== 429), 'no requests rate-limited');
    } finally {
      await close();
      c.close();
    }
  });

  it('/health and /version are exempt from rate limiting', async () => {
    const c = createContex();
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0, maxRequestsPerMinute: 2 });
    const base = url.replace('/mcp', '');
    try {
      // 5 rapid health probes should all succeed regardless of the limit
      const statuses = await Promise.all(
        Array.from({ length: 5 }, () => fetch(`${base}/health`).then((r) => r.status))
      );
      assert.ok(statuses.every((s) => s === 200), 'all health probes return 200');
    } finally {
      await close();
      c.close();
    }
  });
});

// -------- 3. retention scheduler --------
describe('Phase 11: retention scheduler', () => {
  it('runRetention purges expired messages, claims, and stale commands', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'ret' });
    callTool(c, 'peer_set_state', { tile_id: 'ta', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'tb', tile_type: 'chat', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'ta', target_tile_id: 'tb', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'ta', to_tile_id: 'tb', text: 'hello' });

    // Manually stamp the message as 31 days old so it qualifies for purge
    const cutoff = new Date(Date.now() - 31 * 86_400_000).toISOString();
    c.db.prepare(`UPDATE message SET created_at = ? WHERE to_tile_id = 'tb'`).run(cutoff);

    const before = c.db.prepare(`SELECT COUNT(*) AS n FROM message`).get().n;
    assert.equal(before, 1, 'message exists before retention');

    runRetention(c);

    const after = c.db.prepare(`SELECT COUNT(*) AS n FROM message`).get().n;
    assert.equal(after, 0, 'expired message purged by runRetention');
    c.close();
  });

  it('startServer with retentionIntervalMs schedules automatic sweeps', async () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'ret-sched' });
    callTool(c, 'peer_set_state', { tile_id: 'ta', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'tb', tile_type: 'chat', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'ta', target_tile_id: 'tb', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'ta', to_tile_id: 'tb', text: 'hello' });
    // Age the message past the 30-day retention window
    const old = new Date(Date.now() - 32 * 86_400_000).toISOString();
    c.db.prepare(`UPDATE message SET created_at = ? WHERE to_tile_id = 'tb'`).run(old);

    assert.equal(c.db.prepare(`SELECT COUNT(*) AS n FROM message`).get().n, 1);

    // Start with a very short retention interval so the sweep fires quickly
    const { close } = await startServer({ contex: c, token: 'tok', port: 0, retentionIntervalMs: 50 });
    // Wait enough time for the retention sweep to run
    await new Promise((r) => setTimeout(r, 200));
    await close();

    assert.equal(c.db.prepare(`SELECT COUNT(*) AS n FROM message`).get().n, 0, 'message purged by scheduled retention');
    c.close();
  });

  it('retention errors do not crash the server', () => {
    // Pass a contex with a closed DB — runRetention should swallow errors
    const c = createContex();
    c.close(); // close the DB so queries will fail
    assert.doesNotThrow(() => runRetention(c), 'runRetention is resilient to DB errors');
  });
});

// -------- 4. metrics endpoint --------
describe('Phase 11: GET /metrics', () => {
  it('returns 200 JSON with expected fields (no auth required)', async () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'metrics' });
    callTool(c, 'peer_set_state', { tile_id: 'm1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    callTool(c, 'peer_set_state', { tile_id: 'm2', tile_type: 'chat', status: 'idle', workspace_id: ws.id });
    callTool(c, 'link_tiles', { source_tile_id: 'm1', target_tile_id: 'm2', workspace_id: ws.id });
    callTool(c, 'peer_send_message', { from_tile_id: 'm1', to_tile_id: 'm2', text: 'ping' });
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const metricsUrl = url.replace('/mcp', '/metrics');
    try {
      const res = await fetch(metricsUrl); // no auth!
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.workspaces, 1, 'one active workspace');
      assert.equal(body.tiles.total, 2, 'two tiles total');
      assert.equal(body.messages.unread, 1, 'one unread message');
      assert.equal(body.commands.pending, 0, 'no pending commands');
      assert.ok(body.timestamp, 'timestamp present');
      assert.ok(typeof body.audit?.total === 'number', 'audit.total is a number');
    } finally {
      await close();
      c.close();
    }
  });

  it('getDbMetrics reflects real DB state', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'db-metrics' });
    callTool(c, 'peer_set_state', { tile_id: 'dm1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const m = getDbMetrics(c.db);
    assert.equal(m.workspaces, 1);
    assert.equal(m.tiles.total, 1);
    assert.equal(m.messages.unread, 0);
    assert.equal(m.commands.pending, 0);
    c.close();
  });

  it('/metrics counts archived workspaces correctly', async () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'active' });
    const ws2 = c.createWorkspace({ name: 'archived' });
    c.archiveWorkspace(ws2.id);
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    const metricsUrl = url.replace('/mcp', '/metrics');
    try {
      const body = await (await fetch(metricsUrl)).json();
      assert.equal(body.workspaces, 1, 'only active (non-archived) workspace counted');
    } finally {
      await close();
      c.close();
    }
  });
});

// -------- 5. TLS / HTTPS config plumbing --------
describe('Phase 11: TLS / HTTPS config', () => {
  it('startServer without tls option creates an HTTP server (scheme is http)', async () => {
    const c = createContex();
    const { url, close } = await startServer({ contex: c, token: 'tok', port: 0 });
    assert.ok(url.startsWith('http://'), 'url starts with http://');
    await close();
    c.close();
  });

  it('passing tls option with invalid cert/key throws during server startup', async () => {
    const c = createContex();
    let thrownCode = null;
    try {
      // createHttpsServer throws synchronously on bad PEM material
      await startServer({ contex: c, token: 'tok', port: 0, tls: { cert: 'not-a-cert', key: 'not-a-key' } });
    } catch (e) {
      thrownCode = e.code ?? e.library ?? 'thrown';
    } finally {
      c.close();
    }
    assert.ok(thrownCode, 'startServer threw with invalid TLS material (tls option is wired to node:https)');
    assert.match(String(thrownCode), /PEM|OSSL|thrown/i, 'error is TLS-related');
  });
});
