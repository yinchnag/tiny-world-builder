import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contexOptionsFromCli,
  createContexSync,
  createContexSyncedStore,
} from '../src/contex.mjs';

function response(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

test('contexOptionsFromCli supports env fallback and env: token indirection', () => {
  const opts = contexOptionsFromCli(
    { contex: true, 'contex-url': 'http://127.0.0.1:7777', 'contex-token': 'env:MY_TOKEN', 'contex-workspace': 'ws_1' },
    { MY_TOKEN: 'secret' },
  );
  assert.deepEqual(opts, {
    enabled: true,
    url: 'http://127.0.0.1:7777',
    token: 'secret',
    workspace: 'ws_1',
  });
});

test('Contex sync posts initialize, initialized, and polly_sync_snapshot', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const msg = JSON.parse(init.body);
    calls.push({ url, msg });
    if (msg.method === 'initialize') {
      return response({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'contex' } } }, { 'mcp-session-id': 'sid_1' });
    }
    if (msg.method === 'notifications/initialized') return response(null);
    assert.equal(msg.method, 'tools/call');
    assert.equal(msg.params.name, 'polly_sync_snapshot');
    assert.equal(msg.params.arguments.workspace_id, 'ws_1');
    assert.equal(msg.params.arguments.registry_path, '/repo/.polly/registry.json');
    assert.equal(msg.params.arguments.items[0].id, 'p1');
    assert.ok(msg.params.arguments.idempotency_key.startsWith('polly:/repo/.polly/registry.json:'));
    return response({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: { ok: true } } });
  };
  const sync = createContexSync({
    url: 'http://127.0.0.1:7777/mcp',
    token: 'tok',
    workspaceId: 'ws_1',
    registryPath: '/repo/.polly/registry.json',
    repoPath: '/repo',
    fetchImpl,
    logger: { warn() {} },
  });
  await sync.schedule({
    policy: { merge: 'human' },
    vendors: ['claude_code', 'codex'],
    items: [{ id: 'p1', title: 'One', status: 'PLANNED' }],
  });
  assert.equal(sync.status().succeeded, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'http://127.0.0.1:7777/mcp');
});

test('Contex sync can list and record Polly action requests', async () => {
  const tools = [];
  const fetchImpl = async (url, init) => {
    const msg = JSON.parse(init.body);
    if (msg.method === 'initialize') {
      return response({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'contex' } } }, { 'mcp-session-id': 'sid_1' });
    }
    if (msg.method === 'notifications/initialized') return response(null);
    tools.push(msg.params);
    if (msg.params.name === 'polly_list_action_requests') {
      assert.equal(msg.params.arguments.pending_only, true);
      return response({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: { requests: [{ request_id: 'pollyreq_1' }] } } });
    }
    assert.equal(msg.params.name, 'polly_record_action_result');
    assert.equal(msg.params.arguments.request_id, 'pollyreq_1');
    assert.equal(msg.params.arguments.status, 'accepted');
    return response({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: { ok: true } } });
  };
  const sync = createContexSync({
    url: 'http://127.0.0.1:7777/mcp',
    token: 'tok',
    workspaceId: 'ws_1',
    registryPath: '/repo/.polly/registry.json',
    fetchImpl,
    logger: { warn() {} },
  });
  const pending = await sync.listActionRequests();
  assert.equal(pending.requests[0].request_id, 'pollyreq_1');
  await sync.recordActionResult({ requestId: 'pollyreq_1', status: 'accepted', message: 'queued' });
  assert.deepEqual(tools.map((tool) => tool.name), ['polly_list_action_requests', 'polly_record_action_result']);
});

test('Contex synced store schedules after successful saves without blocking', async () => {
  const saved = [];
  const synced = [];
  const store = {
    load: () => ({}),
    save(path, reg) { saved.push({ path, reg }); return reg; },
  };
  const wrapped = createContexSyncedStore(store, {
    schedule(reg) { synced.push(reg); return Promise.resolve(); },
  });
  const reg = { version: 1, items: [] };
  assert.equal(wrapped.save('/tmp/registry.json', reg), reg);
  assert.deepEqual(saved, [{ path: '/tmp/registry.json', reg }]);
  assert.deepEqual(synced, [reg]);
});
