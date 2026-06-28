import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pollyDaemonTileId,
  normalizePollyStatus,
  pollyItemTileId,
  pollyItemToTaskDraft,
  pollyRegistryHash,
} from '../src/domain/polly.mjs';
import { createContex } from '../src/index.mjs';
import { listResources, readResource } from '../src/resources.mjs';
import { callTool, toolCatalog } from '../src/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(HERE, 'fixtures', 'polly-registry.example.json');
const registryPath = '/repo/.polly/registry.json';

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

test('Polly status mapping covers the fixture states', () => {
  const byId = Object.fromEntries(fixture().items.map((item) => [item.id, normalizePollyStatus(item.status)]));
  assert.equal(byId.p20.task_status, 'open');
  assert.equal(byId.p9.task_status, 'in_progress');
  assert.equal(byId.p15.task_status, 'review');
  assert.equal(byId.p10.task_status, 'blocked');
  assert.equal(byId.p21.task_status, 'paused');
  assert.equal(byId.p8.task_status, 'done');
  assert.equal(byId.p10.human_attention, true);
  assert.equal(byId.p21.human_attention, true);
});

test('Polly registry and item IDs are deterministic and scoped', () => {
  const hash = pollyRegistryHash(registryPath);
  assert.equal(hash, pollyRegistryHash(registryPath));
  assert.notEqual(hash, pollyRegistryHash('/other/.polly/registry.json'));
  assert.equal(pollyDaemonTileId(registryPath), `polly:${hash}:daemon`);
  assert.equal(pollyItemTileId(registryPath, 'p9'), `polly:${hash}:item:p9`);
});

test('Polly item task draft preserves original status in metadata', () => {
  const item = fixture().items.find((entry) => entry.id === 'p10');
  const draft = pollyItemToTaskDraft({ registry_path: registryPath, item });
  assert.equal(draft.title, item.title);
  assert.equal(draft.description, item.spec);
  assert.equal(draft.status, 'blocked');
  assert.equal(draft.blocker, item.blockedOn);
  assert.equal(draft.owner_tile_id, pollyItemTileId(registryPath, 'p10'));
  assert.equal(draft.metadata.source, 'polly');
  assert.equal(draft.metadata.polly_item_id, 'p10');
  assert.equal(draft.metadata.polly_status, 'BLOCKED');
  assert.equal(draft.metadata.implementer, 'codex');
  assert.equal(draft.metadata.reviewer, 'claude_code');
  assert.equal(draft.metadata.worktree, '.worktrees/p10-onboarding-foundation');
});

test('unknown Polly statuses are rejected before snapshot sync', () => {
  assert.throws(
    () => normalizePollyStatus('WAITING_FOR_MOONLIGHT'),
    (e) => e.code === 'CONTEXT_BAD_REQUEST',
  );
});

test('polly_sync_snapshot upserts daemon tile, item tasks, and worktree claims', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  const reg = fixture();
  const out = c.syncPollySnapshot({
    workspace_id: ws.id,
    registry_path: registryPath,
    repo_path: '/repo',
    policy: reg.policy,
    vendors: reg.vendors,
    items: reg.items,
  });
  assert.equal(out.ok, true);
  assert.equal(out.item_count, reg.items.length);
  assert.equal(c.getTile(pollyDaemonTileId(registryPath)).status, 'working');

  const tasks = c.listTasks(ws.id, { channel: out.channel });
  assert.equal(tasks.length, reg.items.length);
  const byOwner = Object.fromEntries(tasks.map((task) => [task.owner_tile_id, task]));
  assert.equal(byOwner[pollyItemTileId(registryPath, 'p9')].status, 'in_progress');
  assert.equal(byOwner[pollyItemTileId(registryPath, 'p15')].status, 'review');
  assert.equal(byOwner[pollyItemTileId(registryPath, 'p10')].status, 'blocked');
  assert.equal(byOwner[pollyItemTileId(registryPath, 'p21')].status, 'paused');
  assert.equal(byOwner[pollyItemTileId(registryPath, 'p8')].status, 'done');
  assert.match(byOwner[pollyItemTileId(registryPath, 'p10')].blocker, /wallet-only/);

  const claims = c.db.prepare(
    `SELECT tile_id, path, mode, section FROM file_claim WHERE workspace_id = ? AND released_at IS NULL ORDER BY path`
  ).all(ws.id);
  assert.ok(claims.some((claim) => claim.path === '.worktrees/p9-wave-inline-edit'));
  assert.ok(claims.every((claim) => claim.section.startsWith('polly:')));
  assert.equal(claims.some((claim) => claim.tile_id === pollyItemTileId(registryPath, 'p8')), false);
  c.close();
});

test('polly_sync_snapshot is stable when the same snapshot is replayed', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  const reg = fixture();
  const first = c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items: reg.items });
  const versions = Object.fromEntries(c.listTasks(ws.id, { channel: first.channel }).map((task) => [task.owner_tile_id, task.version]));
  const second = c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items: reg.items });
  assert.equal(second.changed_tasks.length, 0);
  assert.deepEqual(second.claims, { declared: 0, released: 0 });
  for (const task of c.listTasks(ws.id, { channel: first.channel })) {
    assert.equal(task.version, versions[task.owner_tile_id]);
  }
  c.close();
});

test('polly_sync_snapshot emits human attention when an item enters blocked or ready', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  const notes = [];
  c.events.on('notification', (note) => notes.push(note));
  const items = fixture().items.filter((item) => ['p10', 'p21'].includes(item.id));
  const out = c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items });
  assert.equal(out.human_attention.length, 2);
  assert.equal(notes.filter((note) => note.method === 'notifications/context/human_attention').length, 2);
  assert.ok(c.listAudit(ws.id).some((event) => event.event_type === 'notification' && event.payload?.source === 'polly'));
  c.close();
});

test('polly_sync_snapshot is exposed as an idempotent MCP tool', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  assert.ok(toolCatalog().some((tool) => tool.name === 'polly_sync_snapshot'));
  const args = {
    workspace_id: ws.id,
    registry_path: registryPath,
    items: fixture().items.slice(0, 1),
    idempotency_key: 'polly-sync-once',
  };
  const first = callTool(c, 'polly_sync_snapshot', args);
  const second = callTool(c, 'polly_sync_snapshot', args);
  assert.deepEqual(second, first);
  assert.equal(c.listTasks(ws.id, { channel: first.channel }).length, 1);
  c.close();
});

test('Polly resources expose registry and item views', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  const reg = fixture();
  const synced = c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items: reg.items });
  const uris = listResources(c).map((resource) => resource.uri);
  assert.ok(uris.includes(`context://workspace/${ws.id}/polly`));
  assert.ok(uris.includes(`context://workspace/${ws.id}/polly/${synced.registry_hash}`));
  assert.ok(uris.includes(`context://workspace/${ws.id}/polly/${synced.registry_hash}/items`));

  const root = JSON.parse(readResource(c, `context://workspace/${ws.id}/polly`).text);
  assert.equal(root.registries[0].registry_hash, synced.registry_hash);
  const summary = JSON.parse(readResource(c, `context://workspace/${ws.id}/polly/${synced.registry_hash}`).text);
  assert.equal(summary.items_total, reg.items.length);
  assert.equal(summary.items_by_status.BLOCKED, 1);
  const items = JSON.parse(readResource(c, `context://workspace/${ws.id}/polly/${synced.registry_hash}/items`).text);
  assert.equal(items.items.length, reg.items.length);
  const p10 = JSON.parse(readResource(c, `context://workspace/${ws.id}/polly/${synced.registry_hash}/item/p10`).text);
  assert.equal(p10.item_id, 'p10');
  assert.equal(p10.status, 'blocked');
  assert.equal(p10.polly_status, 'BLOCKED');
  assert.ok(p10.claims.some((claim) => claim.path === '.worktrees/p10-onboarding-foundation'));
  c.close();
});

test('Polly action requests are recorded, listed, and resolved by Polly', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  const reg = fixture();
  c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items: reg.items });
  const notes = [];
  c.events.on('notification', (note) => notes.push(note));

  const req = c.requestPollyAction({
    workspace_id: ws.id,
    registry_path: registryPath,
    item_id: 'p21',
    action: 'rerun_gates',
    reason: 'Human wants a fresh gate run before merge.',
    requested_by_tile_id: 'chat_human',
  });
  assert.equal(req.ok, true);
  assert.equal(req.status, 'requested');
  assert.equal(req.item_id, 'p21');

  const pending = c.listPollyActionRequests({ workspace_id: ws.id, registry_path: registryPath, pending_only: true });
  assert.equal(pending.requests.length, 1);
  assert.equal(pending.requests[0].request_id, req.request_id);
  assert.equal(pending.requests[0].action, 'rerun_gates');

  const result = c.recordPollyActionResult({
    workspace_id: ws.id,
    request_id: req.request_id,
    status: 'accepted',
    message: 'Will rerun gates on next tick.',
  });
  assert.equal(result.status, 'accepted');
  const after = c.listPollyActionRequests({ workspace_id: ws.id, registry_path: registryPath });
  assert.equal(after.requests[0].status, 'accepted');
  assert.equal(after.requests[0].result.message, 'Will rerun gates on next tick.');
  assert.equal(c.listPollyActionRequests({ workspace_id: ws.id, pending_only: true }).requests.length, 1);
  assert.ok(notes.some((note) => note.method === 'notifications/context/polly_action_requested'));
  assert.ok(notes.some((note) => note.method === 'notifications/context/polly_action_result'));
  c.close();
});

test('Polly action tools and resources expose assisted-operation requests', () => {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'polly', repository_path: '/repo' });
  c.syncPollySnapshot({ workspace_id: ws.id, registry_path: registryPath, items: fixture().items });
  assert.ok(toolCatalog().some((tool) => tool.name === 'polly_request_action'));
  assert.ok(toolCatalog().some((tool) => tool.name === 'polly_list_action_requests'));
  assert.ok(toolCatalog().some((tool) => tool.name === 'polly_record_action_result'));

  const first = callTool(c, 'polly_request_action', {
    workspace_id: ws.id,
    registry_path: registryPath,
    item_id: 'p10',
    action: 'add_note',
    reason: 'Please capture the human blocker detail.',
    payload: { note: 'Wallet-only accounts are still pending.' },
    idempotency_key: 'polly-action-note-once',
  });
  const second = callTool(c, 'polly_request_action', {
    workspace_id: ws.id,
    registry_path: registryPath,
    item_id: 'p10',
    action: 'add_note',
    reason: 'Please capture the human blocker detail.',
    payload: { note: 'Wallet-only accounts are still pending.' },
    idempotency_key: 'polly-action-note-once',
  });
  assert.deepEqual(second, first);

  const listed = callTool(c, 'polly_list_action_requests', { workspace_id: ws.id, pending_only: true });
  assert.equal(listed.requests.length, 1);
  const resource = JSON.parse(readResource(c, `context://workspace/${ws.id}/polly/actions`).text);
  assert.equal(resource.requests[0].request_id, first.request_id);
  c.close();
});
