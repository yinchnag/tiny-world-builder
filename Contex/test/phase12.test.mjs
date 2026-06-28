// -------- Phase 12: scoped tokens + legacy import + workspace notification filter --------
// Covers:
//   A. createTokenStore — issue, authenticate, revoke, expiry, list, admin check
//   B. MCP tool enforcement — adminOnly tools blocked for non-admin tokens via server
//   C. importTileDir — reads state.json / skills.json / objective.md from disk
//   D. import_tile_dir MCP tool — end-to-end via server
//   E. GET /events?workspace_id= filter — only matching workspace events delivered

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContex } from '../src/index.mjs';
import { startServer } from '../src/server.mjs';
import { createTokenStore } from '../src/auth.mjs';
import { callTool } from '../src/tools.mjs';
import { MockAgent } from './helpers.mjs';

function makeTileDir(base, { state, skills, objective } = {}) {
  const dir = mkdtempSync(join(base, 'tile-'));
  if (state) writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  if (skills) writeFileSync(join(dir, 'skills.json'), JSON.stringify(skills));
  if (objective) writeFileSync(join(dir, 'objective.md'), objective);
  return dir;
}

// -------- A. createTokenStore unit tests --------
describe('Phase 12: createTokenStore', () => {
  it('master token authenticates with * scope', () => {
    const store = createTokenStore('master-tok');
    const entry = store.authenticate('master-tok');
    assert.ok(entry, 'master token authenticates');
    assert.ok(entry.scopes.has('*'), 'master has * scope');
    assert.ok(store.isAdmin(entry), 'master is admin');
  });

  it('unknown token returns null', () => {
    const store = createTokenStore('master');
    assert.equal(store.authenticate('unknown'), null);
    assert.equal(store.authenticate(null), null);
    assert.equal(store.authenticate(undefined), null);
  });

  it('issue returns a new token with specified scopes', () => {
    const store = createTokenStore('master');
    const result = store.issue({ scopes: ['agent'], label: 'worker-1' });
    assert.ok(result.token, 'token string present');
    assert.deepEqual(result.scopes, ['agent']);
    assert.equal(result.label, 'worker-1');
    assert.equal(result.expires_at, null, 'no TTL = no expiry');
  });

  it('issued token authenticates and has correct scope', () => {
    const store = createTokenStore('master');
    const { token } = store.issue({ scopes: ['agent'] });
    const entry = store.authenticate(token);
    assert.ok(entry, 'issued token authenticates');
    assert.ok(entry.scopes.has('agent'), 'has agent scope');
    assert.ok(!store.isAdmin(entry), 'agent token is not admin');
  });

  it('issued token with admin scope passes isAdmin', () => {
    const store = createTokenStore('master');
    const { token } = store.issue({ scopes: ['admin'] });
    const entry = store.authenticate(token);
    assert.ok(store.isAdmin(entry), 'admin-scoped token is admin');
  });

  it('expired token is rejected', async () => {
    const store = createTokenStore('master');
    const { token } = store.issue({ scopes: ['agent'], ttlSeconds: 0.01 }); // 10 ms TTL
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(store.authenticate(token), null, 'expired token rejected');
  });

  it('expires_at is an ISO string when ttlSeconds is set', () => {
    const store = createTokenStore('master');
    const result = store.issue({ scopes: ['agent'], ttlSeconds: 3600 });
    assert.ok(result.expires_at, 'expires_at set');
    assert.ok(!isNaN(Date.parse(result.expires_at)), 'expires_at is valid ISO date');
  });

  it('revoke removes an issued token', () => {
    const store = createTokenStore('master');
    const { token } = store.issue({ scopes: ['agent'] });
    assert.ok(store.authenticate(token), 'token exists before revoke');
    const ok = store.revoke(token);
    assert.ok(ok, 'revoke returns true');
    assert.equal(store.authenticate(token), null, 'token rejected after revoke');
  });

  it('revoke of master token is rejected', () => {
    const store = createTokenStore('master-tok');
    const ok = store.revoke('master-tok');
    assert.equal(ok, false, 'master cannot be revoked');
    assert.ok(store.authenticate('master-tok'), 'master still authenticates');
  });

  it('list returns prefix + scopes for active non-master tokens', () => {
    const store = createTokenStore('master');
    const r1 = store.issue({ scopes: ['agent'], label: 'a' });
    const r2 = store.issue({ scopes: ['admin'], label: 'b' });
    const list = store.list();
    assert.equal(list.length, 2);
    for (const entry of list) {
      assert.ok(entry.token_prefix.endsWith('...'), 'prefix ends with ...');
      assert.ok(entry.token_prefix.length < 20, 'prefix is short');
      assert.ok(!entry.token_prefix.includes(r1.token.slice(8)), 'full token not in prefix');
    }
    const labels = list.map((e) => e.label).sort();
    assert.deepEqual(labels, ['a', 'b']);
  });

  it('list excludes expired tokens', async () => {
    const store = createTokenStore('master');
    store.issue({ scopes: ['agent'], ttlSeconds: 0.01, label: 'gone' });
    store.issue({ scopes: ['agent'], label: 'kept' });
    await new Promise((r) => setTimeout(r, 50));
    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'kept');
  });
});

// -------- B. MCP tool enforcement via HTTP server --------
// Note: MockAgent.rpc returns { status, body } with body already parsed.
describe('Phase 12: adminOnly tool enforcement', () => {
  let url, masterToken, agentToken, close, c, tokenStore;

  before(async () => {
    c = createContex();
    c.createWorkspace({ name: 'admin-test' });
    ({ url, token: masterToken, tokenStore, close } = await startServer({ contex: c, token: 'master-secret', port: 0 }));
    ({ token: agentToken } = tokenStore.issue({ scopes: ['agent'], label: 'test-agent' }));
  });

  after(async () => { await close(); c.close(); });

  it('master token can call list_client_tokens', async () => {
    const agent = new MockAgent(url, masterToken, 'master-tile');
    const { status, body } = await agent.rpc('tools/call', { name: 'list_client_tokens', arguments: {} });
    assert.equal(status, 200);
    assert.ok(!body.result?.isError, 'no error with master token');
    assert.ok(Array.isArray(body.result?.structuredContent?.tokens), 'tokens array present');
  });

  it('agent token cannot call list_client_tokens (scope denied)', async () => {
    const agent = new MockAgent(url, agentToken, 'agent-tile');
    const { status, body } = await agent.rpc('tools/call', { name: 'list_client_tokens', arguments: {} });
    assert.equal(status, 200);
    assert.ok(body.result?.isError, 'isError for scope-denied call');
    assert.ok(
      body.result?.content?.[0]?.text?.includes('CONTEXT_SCOPE_DENIED'),
      `Expected CONTEXT_SCOPE_DENIED in: ${JSON.stringify(body.result?.content)}`,
    );
  });

  it('agent token can call non-admin tools normally', async () => {
    const agent = new MockAgent(url, agentToken, 'agent-tile2');
    const { status, body } = await agent.rpc('tools/call', {
      name: 'peer_set_state',
      arguments: { tile_id: 'agent-tile2', tile_type: 'terminal', status: 'idle' },
    });
    assert.equal(status, 200);
    assert.ok(!body.result?.isError, 'non-admin tool succeeds with agent token');
  });

  it('expired token gets 401', async () => {
    const { token: shortLived } = tokenStore.issue({ scopes: ['agent'], ttlSeconds: 0.01 });
    await new Promise((r) => setTimeout(r, 50));
    const agent = new MockAgent(url, shortLived, 'exp-tile');
    const { status } = await agent.rpc('tools/list', {});
    assert.equal(status, 401);
  });

  it('issue_client_token via MCP creates a valid new token', async () => {
    const agent = new MockAgent(url, masterToken, 'master-tile2');
    const { status, body } = await agent.rpc('tools/call', {
      name: 'issue_client_token',
      arguments: { scopes: ['agent'], label: 'via-mcp' },
    });
    assert.equal(status, 200);
    assert.ok(!body.result?.isError, `issue_client_token error: ${JSON.stringify(body.result)}`);
    const issued = body.result?.structuredContent;
    assert.ok(issued?.token, 'token returned');
    assert.deepEqual(issued.scopes, ['agent']);
    assert.equal(issued.label, 'via-mcp');

    // The newly issued token should be able to call non-admin tools
    const newAgent = new MockAgent(url, issued.token, 'new-agent-tile');
    const r2 = await newAgent.rpc('tools/call', {
      name: 'peer_set_state',
      arguments: { tile_id: 'new-agent-tile', tile_type: 'terminal', status: 'idle' },
    });
    assert.equal(r2.status, 200);
    assert.ok(!r2.body.result?.isError);
  });

  it('revoke_client_token via MCP invalidates the token', async () => {
    const { token: tok } = tokenStore.issue({ scopes: ['agent'], label: 'to-revoke' });
    // Verify it works
    const agent = new MockAgent(url, tok, 'revoke-tile');
    const { status: s1 } = await agent.rpc('tools/list', {});
    assert.equal(s1, 200, 'token works before revoke');

    // Revoke via master
    const master = new MockAgent(url, masterToken, 'master-tile3');
    const { status: s2, body } = await master.rpc('tools/call', {
      name: 'revoke_client_token',
      arguments: { token: tok },
    });
    assert.equal(s2, 200);
    assert.ok(body.result?.structuredContent?.revoked === true, 'revoked=true');

    // Now the token should be rejected
    const { status: s3 } = await agent.rpc('tools/list', {});
    assert.equal(s3, 401, 'revoked token gets 401');
  });
});

// -------- C. importTileDir domain function --------
describe('Phase 12: importTileDir domain function', () => {
  const base = mkdtempSync(join(tmpdir(), 'contex-test-'));
  after(() => rmSync(base, { recursive: true, force: true }));

  it('imports state.json tasks into the workspace channel', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'legacy' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-1', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const dir = makeTileDir(base, {
      state: { tasks: [{ title: 'Write tests' }, { title: 'Review PR' }], paused: false },
    });
    const result = c.importTileDir({ tile_id: 'tile-1', dir, workspace_id: ws.id });
    assert.equal(result.tile_id, 'tile-1');
    assert.equal(result.imported.state?.tasks, 2, 'two tasks imported');

    const tasks = c.listTasks(ws.id);
    assert.equal(tasks.length, 2, 'tasks in DB');
    assert.ok(tasks.some((t) => t.title === 'Write tests'));
    c.close();
  });

  it('imports skills.json into skill_assignment', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'legacy-skills' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-2', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const dir = makeTileDir(base, {
      skills: { enabled: ['code-review', 'test-runner'], disabled: ['deploy'] },
    });
    const result = c.importTileDir({ tile_id: 'tile-2', dir, workspace_id: ws.id });
    assert.deepEqual(result.imported.skills, { enabled: 2, disabled: 1 });

    const skillsList = c.listSkills('tile-2');
    assert.ok(Array.isArray(skillsList.enabled), 'enabled array');
    assert.ok(skillsList.enabled.includes('code-review'));
    assert.ok(skillsList.disabled.includes('deploy'));
    c.close();
  });

  it('imports objective.md as a new objective version', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'legacy-obj' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-3', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const markdown = '# Tile Objective\n\nBe helpful.';
    const dir = makeTileDir(base, { objective: markdown });
    const result = c.importTileDir({ tile_id: 'tile-3', dir, workspace_id: ws.id });
    assert.ok(result.imported.objective === true, 'objective imported');

    const obj = c.getObjective('tile-3');
    assert.ok(obj, 'objective exists');
    assert.equal(obj.markdown, markdown, 'markdown preserved');
    c.close();
  });

  it('silently skips missing files (partial directory)', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'partial' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-4', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    // Directory with only state.json
    const dir = makeTileDir(base, { state: { tasks: [], paused: false } });
    const result = c.importTileDir({ tile_id: 'tile-4', dir, workspace_id: ws.id });
    assert.ok('state' in result.imported, 'state processed');
    assert.ok(!('skills' in result.imported), 'skills skipped (no file)');
    assert.ok(!('objective' in result.imported), 'objective skipped (no file)');
    c.close();
  });

  it('peers.md is not imported (auto-generated file is ignored)', () => {
    const c = createContex();
    const ws = c.createWorkspace({ name: 'peers-test' });
    callTool(c, 'peer_set_state', { tile_id: 'tile-5', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });

    const dir = makeTileDir(base, {});
    writeFileSync(join(dir, 'peers.md'), '# Peers\n- agent-a');
    // Should not throw, peers.md is intentionally not parsed
    assert.doesNotThrow(() => c.importTileDir({ tile_id: 'tile-5', dir, workspace_id: ws.id }));
    c.close();
  });
});

// -------- D. import_tile_dir MCP tool via HTTP --------
describe('Phase 12: import_tile_dir via MCP', () => {
  const base = mkdtempSync(join(tmpdir(), 'contex-mcp-import-'));
  let url, token, close, c;

  before(async () => {
    c = createContex();
    const ws = c.createWorkspace({ name: 'mcp-import' });
    callTool(c, 'peer_set_state', { tile_id: 'import-tile', tile_type: 'terminal', status: 'idle', workspace_id: ws.id });
    ({ url, token, close } = await startServer({ contex: c, token: 'master-tok', port: 0 }));
  });
  after(async () => { await close(); c.close(); rmSync(base, { recursive: true, force: true }); });

  it('import_tile_dir tool imports all three files end-to-end', async () => {
    const dir = makeTileDir(base, {
      state: { tasks: [{ title: 'MCP task' }], paused: false },
      skills: { enabled: ['lint'], disabled: [] },
      objective: '# MCP Objective',
    });

    const ws = c.soleWorkspace();
    const agent = new MockAgent(url, token, 'import-tile');
    const { status, body } = await agent.rpc('tools/call', {
      name: 'import_tile_dir',
      arguments: { tile_id: 'import-tile', dir, workspace_id: ws.id },
    });
    assert.equal(status, 200);
    assert.ok(!body.result?.isError, JSON.stringify(body.result));
    const result = body.result?.structuredContent;
    assert.equal(result.tile_id, 'import-tile');
    assert.equal(result.imported.state?.tasks, 1);
    assert.deepEqual(result.imported.skills, { enabled: 1, disabled: 0 });
    assert.equal(result.imported.objective, true);
  });

  it('import_tile_dir is blocked for non-admin tokens (direct callTool)', () => {
    const dir = mkdtempSync(join(base, 'blocked-'));
    const c2 = createContex();
    const agentEntry = { scopes: new Set(['agent']) };
    assert.throws(
      () => callTool(c2, 'import_tile_dir', { tile_id: 'x', dir }, agentEntry),
      (e) => e.code === 'CONTEXT_SCOPE_DENIED',
      'scope denied for non-admin entry',
    );
    c2.close();
  });
});

// -------- E. GET /events?workspace_id= filter --------
describe('Phase 12: GET /events workspace_id filter', () => {
  let url, token, close, c, ws1, ws2;

  before(async () => {
    c = createContex();
    ws1 = c.createWorkspace({ name: 'ws1' });
    ws2 = c.createWorkspace({ name: 'ws2' });
    ({ url, token, close } = await startServer({ contex: c, token: 'tok', port: 0 }));
  });
  after(async () => { await close(); c.close(); });

  it('filters events by workspace_id — only matching workspace delivered', async () => {
    const eventsUrl = url.replace('/mcp', `/events?workspace_id=${ws1.id}`);
    const events = [];

    const ac = new AbortController();
    const streamDone = fetch(eventsUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: ac.signal,
    }).then(async (r) => {
      for await (const chunk of r.body) {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n')) {
          if (line.startsWith('data:')) {
            try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
          }
        }
      }
    }).catch(() => {});

    // Small delay to let SSE stream establish
    await new Promise((r) => setTimeout(r, 50));

    // Fire events in both workspaces
    callTool(c, 'peer_set_state', { tile_id: 'ws1-tile', tile_type: 'terminal', status: 'idle', workspace_id: ws1.id });
    callTool(c, 'peer_set_state', { tile_id: 'ws2-tile', tile_type: 'terminal', status: 'idle', workspace_id: ws2.id });

    // Wait for events to arrive
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await streamDone;

    // Should only see ws1 events
    const ws2Events = events.filter((e) => e.params?.workspace_id === ws2.id);
    assert.equal(ws2Events.length, 0, 'no ws2 events on ws1 stream');
    const ws1Events = events.filter((e) => e.params?.workspace_id === ws1.id);
    assert.ok(ws1Events.length > 0, 'at least one ws1 event received');
  }, { timeout: 5000 });

  it('unfiltered /events (no workspace_id) receives events from all workspaces', async () => {
    const eventsUrl = url.replace('/mcp', '/events');
    const events = [];

    const ac = new AbortController();
    const streamDone = fetch(eventsUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: ac.signal,
    }).then(async (r) => {
      for await (const chunk of r.body) {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n')) {
          if (line.startsWith('data:')) {
            try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
          }
        }
      }
    }).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    callTool(c, 'peer_set_state', { tile_id: 'multi-ws1', tile_type: 'terminal', status: 'idle', workspace_id: ws1.id });
    callTool(c, 'peer_set_state', { tile_id: 'multi-ws2', tile_type: 'chat', status: 'idle', workspace_id: ws2.id });

    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await streamDone;

    const seen = new Set(events.filter((e) => e.params?.workspace_id).map((e) => e.params.workspace_id));
    assert.ok(seen.has(ws1.id), 'ws1 events present');
    assert.ok(seen.has(ws2.id), 'ws2 events present');
  }, { timeout: 5000 });
});
