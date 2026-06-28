// -------- Polly Arranger integration helpers --------
// Contract-only helpers for the optional Polly -> Contex bridge. Polly remains
// the source of truth for orchestration; these functions normalize Polly terms
// into Contex task/tile vocabulary for snapshot sync and UI display.

import { err } from '../errors.mjs';
import { newTaskId, newClaimId, newId } from '../ids.mjs';
import { nowIso, audit, parseJson } from '../store.mjs';
import { normalizeClaimPath } from './claims.mjs';

export const POLLY_STATUS_MAP = {
  PLANNED: { task_status: 'open', tile_status: 'idle' },
  BUILDING: { task_status: 'in_progress', tile_status: 'working' },
  FIXING: { task_status: 'in_progress', tile_status: 'working' },
  IN_REVIEW: { task_status: 'review', tile_status: 'working' },
  RE_REVIEW: { task_status: 'review', tile_status: 'working' },
  BLOCKED: { task_status: 'blocked', tile_status: 'blocked', human_attention: true },
  READY_FOR_HUMAN_MERGE: { task_status: 'paused', tile_status: 'waiting', human_attention: true },
  MERGED: { task_status: 'done', tile_status: 'done', terminal: true },
  ABANDONED: { task_status: 'cancelled', tile_status: 'done', terminal: true },
};

export const POLLY_ACTIONS = new Set([
  'pause_item',
  'add_note',
  'mark_human_decision',
  'rerun_gates',
]);

export const POLLY_ACTION_RESULTS = new Set([
  'accepted',
  'rejected',
  'applied',
  'failed',
]);

export function normalizePollyStatus(status) {
  const key = String(status || '').trim().toUpperCase();
  const mapped = POLLY_STATUS_MAP[key];
  if (!mapped) throw err.badRequest(`Unknown Polly status: ${status || '(empty)'}`);
  return { polly_status: key, ...mapped };
}

export function pollyRegistryHash(registryPath) {
  const input = String(registryPath || '').trim();
  if (!input) throw err.badRequest('registry_path is required');
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

export function pollyDaemonTileId(registryPath) {
  return `polly:${pollyRegistryHash(registryPath)}:daemon`;
}

export function pollyItemTileId(registryPath, itemId) {
  if (!itemId) throw err.badRequest('item id is required');
  return `polly:${pollyRegistryHash(registryPath)}:item:${itemId}`;
}

export function pollyItemToTaskDraft({ registry_path, item }) {
  if (!item || typeof item !== 'object') throw err.badRequest('Polly item is required');
  if (!item.id) throw err.badRequest('Polly item id is required');
  const status = normalizePollyStatus(item.status);
  return {
    channel: `polly:${pollyRegistryHash(registry_path)}`,
    title: item.title || item.id,
    description: item.spec || null,
    status: status.task_status,
    owner_tile_id: pollyItemTileId(registry_path, item.id),
    blocker: item.blockedOn || null,
    metadata: {
      source: 'polly',
      registry_path,
      polly_item_id: item.id,
      polly_status: status.polly_status,
      implementer: item.implementer || null,
      reviewer: item.reviewer || null,
      worktree: item.worktree || null,
      branch: item.branch || null,
      pr: item.pr ?? null,
      wave: item.wave || null,
    },
  };
}

export function syncPollySnapshot(db, input = {}, opts = {}) {
  const { clock, correlation_id } = opts;
  const workspaceId = input.workspace_id;
  if (!workspaceId) throw err.badRequest('workspace_id is required');
  if (!db.prepare('SELECT id FROM workspace WHERE id = ?').get(workspaceId)) {
    throw err.workspaceNotFound(workspaceId);
  }
  const registryPath = input.registry_path;
  if (!registryPath) throw err.badRequest('registry_path is required');
  if (!Array.isArray(input.items)) throw err.badRequest('items must be an array');

  const ts = nowIso(clock);
  const hash = pollyRegistryHash(registryPath);
  const channel = `polly:${hash}`;
  const daemonTileId = pollyDaemonTileId(registryPath);
  const seenOwnerIds = new Set();
  const tasks = [];
  const changed_tasks = [];
  const human_attention = [];
  let claims_released = 0;
  let claims_declared = 0;

  upsertPollyTile(db, {
    workspace_id: workspaceId,
    tile_id: daemonTileId,
    tile_type: 'extension',
    title: 'Polly Arranger',
    status: 'working',
    task: `Syncing ${input.items.length} Polly item${input.items.length === 1 ? '' : 's'}`,
    progress: `registry:${hash}`,
    summary: `vendors:${(input.vendors || []).join(',') || 'unknown'}`,
    branch: null,
    worktree: null,
    blocker: null,
    capabilities: ['polly_sync'],
  }, ts);

  audit(db, {
    workspace_id: workspaceId,
    actor_type: 'integration',
    actor_id: daemonTileId,
    tile_id: daemonTileId,
    event_type: 'polly_snapshot_synced',
    entity_type: 'polly_registry',
    entity_id: channel,
    correlation_id: correlation_id ?? null,
    payload: {
      source: 'polly',
      registry_path: registryPath,
      repo_path: input.repo_path ?? null,
      item_count: input.items.length,
      policy: input.policy ?? null,
      vendors: input.vendors ?? [],
    },
    created_at: ts,
  });

  for (const item of input.items) {
    const draft = pollyItemToTaskDraft({ registry_path: registryPath, item });
    const status = normalizePollyStatus(item.status);
    const itemTileId = draft.owner_tile_id;
    seenOwnerIds.add(itemTileId);

    upsertPollyTile(db, {
      workspace_id: workspaceId,
      tile_id: itemTileId,
      tile_type: 'status',
      title: item.title || item.id,
      status: status.tile_status,
      task: item.title || item.id,
      progress: status.polly_status,
      summary: item.pr != null ? `PR #${item.pr}` : null,
      branch: item.branch || null,
      worktree: item.worktree || null,
      blocker: item.blockedOn || null,
      capabilities: ['polly_item'],
    }, ts);

    const existing = db.prepare(
      `SELECT * FROM task WHERE workspace_id = ? AND channel = ? AND owner_tile_id = ?`
    ).get(workspaceId, channel, itemTileId);
    const task = existing
      ? updatePollyTask(db, existing, draft, status, ts)
      : insertPollyTask(db, workspaceId, daemonTileId, draft, status, ts);
    tasks.push(mapPollyTask(task));
    if (!existing || task.version !== existing.version) changed_tasks.push(task.id);

    const claimStats = syncPollyClaims(db, workspaceId, itemTileId, item, status, registryPath, ts);
    claims_released += claimStats.released;
    claims_declared += claimStats.declared;

    const enteredAttention = status.human_attention && (!existing || existing.status !== status.task_status);
    if (enteredAttention) {
      human_attention.push({
        source: 'polly',
        registry_path: registryPath,
        item_id: item.id,
        tile_id: itemTileId,
        text: attentionText(item, status.polly_status),
      });
    }

    audit(db, {
      workspace_id: workspaceId,
      actor_type: 'integration',
      actor_id: daemonTileId,
      tile_id: itemTileId,
      event_type: 'polly_item_synced',
      entity_type: 'task',
      entity_id: task.id,
      correlation_id: correlation_id ?? null,
      payload: draft.metadata,
      created_at: ts,
    });
  }

  const stale = markMissingPollyItemsCancelled(db, {
    workspaceId,
    channel,
    daemonTileId,
    seenOwnerIds,
    ts,
    correlation_id,
  });
  claims_released += stale.claims_released;
  changed_tasks.push(...stale.changed_tasks);

  return {
    ok: true,
    source: 'polly',
    workspace_id: workspaceId,
    registry_hash: hash,
    channel,
    daemon_tile_id: daemonTileId,
    item_count: input.items.length,
    tasks,
    changed_tasks,
    human_attention,
    claims: { declared: claims_declared, released: claims_released },
  };
}

export function requestPollyAction(db, input = {}, opts = {}) {
  const { clock, correlation_id } = opts;
  const workspaceId = input.workspace_id;
  if (!workspaceId) throw err.badRequest('workspace_id is required');
  if (!db.prepare('SELECT id FROM workspace WHERE id = ?').get(workspaceId)) {
    throw err.workspaceNotFound(workspaceId);
  }
  const registryPath = input.registry_path || null;
  const hash = registryPath ? pollyRegistryHash(registryPath) : String(input.registry_hash || '').trim();
  const itemId = input.item_id;
  const action = String(input.action || '').trim();
  if (!hash) throw err.badRequest('registry_path or registry_hash is required');
  if (!itemId) throw err.badRequest('item_id is required');
  if (!POLLY_ACTIONS.has(action)) throw err.badRequest(`Unsupported Polly action: ${action || '(empty)'}`);
  const itemTileId = registryPath ? pollyItemTileId(registryPath, itemId) : `polly:${hash}:item:${itemId}`;
  const task = db.prepare(
    `SELECT id FROM task WHERE workspace_id = ? AND channel = ? AND owner_tile_id = ?`
  ).get(workspaceId, `polly:${hash}`, itemTileId);
  if (!task) throw err.badRequest(`Unknown Polly item: ${itemId}`);

  const ts = nowIso(clock);
  const requestId = input.request_id || newId('pollyreq');
  const payload = {
    source: 'polly',
    request_id: requestId,
    registry_path: registryPath,
    registry_hash: hash,
    item_id: itemId,
    action,
    reason: input.reason || null,
    payload: input.payload || {},
    requested_by_tile_id: input.requested_by_tile_id || null,
    status: 'requested',
  };
  audit(db, {
    workspace_id: workspaceId,
    actor_type: 'operator',
    actor_id: input.requested_by_tile_id || null,
    tile_id: itemTileId,
    event_type: 'polly_action_requested',
    entity_type: 'polly_action_request',
    entity_id: requestId,
    correlation_id: correlation_id ?? null,
    payload,
    created_at: ts,
  });
  return { ok: true, ...payload, created_at: ts };
}

export function listPollyActionRequests(db, input = {}) {
  const workspaceId = input.workspace_id;
  if (!workspaceId) throw err.badRequest('workspace_id is required');
  if (!db.prepare('SELECT id FROM workspace WHERE id = ?').get(workspaceId)) {
    throw err.workspaceNotFound(workspaceId);
  }
  const sinceSequence = Number(input.since_sequence || 0);
  const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
  const rows = db.prepare(
    `SELECT * FROM audit_event
      WHERE workspace_id = ?
        AND event_type IN ('polly_action_requested', 'polly_action_result')
        AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?`
  ).all(workspaceId, sinceSequence, limit);
  return summarizePollyActionRows(rows, input);
}

export function recordPollyActionResult(db, input = {}, opts = {}) {
  const { clock, correlation_id } = opts;
  const workspaceId = input.workspace_id;
  const requestId = input.request_id;
  const status = String(input.status || '').trim();
  if (!workspaceId) throw err.badRequest('workspace_id is required');
  if (!requestId) throw err.badRequest('request_id is required');
  if (!POLLY_ACTION_RESULTS.has(status)) throw err.badRequest(`Unsupported Polly action result: ${status || '(empty)'}`);
  const request = latestPollyActionRequest(db, workspaceId, requestId);
  if (!request) throw err.badRequest(`Unknown Polly action request: ${requestId}`);
  const ts = nowIso(clock);
  const payload = {
    source: 'polly',
    request_id: requestId,
    registry_path: request.registry_path ?? null,
    registry_hash: request.registry_hash,
    item_id: request.item_id,
    action: request.action,
    status,
    message: input.message || null,
    payload: input.payload || {},
    handled_by_tile_id: input.handled_by_tile_id || (request.registry_path ? pollyDaemonTileId(request.registry_path) : `polly:${request.registry_hash}:daemon`),
  };
  audit(db, {
    workspace_id: workspaceId,
    actor_type: 'integration',
    actor_id: payload.handled_by_tile_id,
    tile_id: request.registry_path ? pollyItemTileId(request.registry_path, request.item_id) : `polly:${request.registry_hash}:item:${request.item_id}`,
    event_type: 'polly_action_result',
    entity_type: 'polly_action_request',
    entity_id: requestId,
    correlation_id: correlation_id ?? null,
    payload,
    created_at: ts,
  });
  return { ok: true, ...payload, created_at: ts };
}

function upsertPollyTile(db, input, ts) {
  const row = db.prepare('SELECT * FROM tile WHERE id = ?').get(input.tile_id);
  const caps = JSON.stringify(input.capabilities || []);
  if (!row) {
    db.prepare(
      `INSERT INTO tile (id, workspace_id, type, title, display_name, status, task, progress, summary,
         blocker, branch, worktree, client_instance_id, capabilities_json, version, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      input.tile_id, input.workspace_id, input.tile_type, input.title, input.title, input.status,
      input.task ?? null, input.progress ?? null, input.summary ?? null, input.blocker ?? null,
      input.branch ?? null, input.worktree ?? null, 'polly-sync', caps, ts, ts, ts
    );
    return true;
  }
  const changed = row.type !== input.tile_type ||
    row.title !== input.title ||
    row.status !== input.status ||
    row.task !== (input.task ?? null) ||
    row.progress !== (input.progress ?? null) ||
    row.summary !== (input.summary ?? null) ||
    row.blocker !== (input.blocker ?? null) ||
    row.branch !== (input.branch ?? null) ||
    row.worktree !== (input.worktree ?? null) ||
    row.capabilities_json !== caps;
  db.prepare(
    `UPDATE tile SET type=?, title=?, display_name=?, status=?, task=?, progress=?, summary=?,
       blocker=?, branch=?, worktree=?, client_instance_id=?, capabilities_json=?,
       version=?, last_seen_at=?, updated_at=? WHERE id=?`
  ).run(
    input.tile_type, input.title, input.title, input.status, input.task ?? null, input.progress ?? null,
    input.summary ?? null, input.blocker ?? null, input.branch ?? null, input.worktree ?? null,
    'polly-sync', caps, changed ? row.version + 1 : row.version, ts, ts, input.tile_id
  );
  return changed;
}

function insertPollyTask(db, workspaceId, daemonTileId, draft, status, ts) {
  const id = newTaskId();
  const completedAt = status.task_status === 'done' ? ts : null;
  db.prepare(
    `INSERT INTO task (id, workspace_id, channel, title, description, status, priority,
       owner_tile_id, creator_tile_id, blocker, result_summary, version, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    id, workspaceId, draft.channel, draft.title, draft.description, draft.status,
    draft.owner_tile_id, daemonTileId, draft.blocker, resultSummary(draft.metadata),
    ts, ts, completedAt
  );
  return db.prepare('SELECT * FROM task WHERE id = ?').get(id);
}

function updatePollyTask(db, existing, draft, status, ts) {
  const nextCompleted = status.task_status === 'done'
    ? (existing.completed_at || ts)
    : existing.completed_at;
  const nextSummary = resultSummary(draft.metadata);
  const changed = existing.title !== draft.title ||
    existing.description !== draft.description ||
    existing.status !== draft.status ||
    existing.blocker !== draft.blocker ||
    existing.result_summary !== nextSummary ||
    existing.completed_at !== nextCompleted;
  if (changed) {
    db.prepare(
      `UPDATE task SET title=?, description=?, status=?, blocker=?, result_summary=?,
         version=?, updated_at=?, completed_at=? WHERE id=?`
    ).run(
      draft.title, draft.description, draft.status, draft.blocker, nextSummary,
      existing.version + 1, ts, nextCompleted, existing.id
    );
  }
  return db.prepare('SELECT * FROM task WHERE id = ?').get(existing.id);
}

function syncPollyClaims(db, workspaceId, tileId, item, status, registryPath, ts) {
  const repoPath = db.prepare('SELECT repository_path FROM workspace WHERE id = ?').get(workspaceId)?.repository_path ?? null;
  const section = `polly:${item.id}:${pollyRegistryHash(registryPath)}`;
  const desired = [];
  if (!status.terminal) {
    const files = [];
    if (item.worktree) files.push({ path: item.worktree, mode: 'edit' });
    if (Array.isArray(item.files)) {
      for (const f of item.files) if (f?.path) files.push({ path: f.path, mode: f.mode || 'edit' });
    }
    for (const f of files) {
      const path = normalizeClaimPath(repoPath, f.path);
      if (!path) continue;
      desired.push({ path, mode: f.mode === 'read' ? 'read' : 'edit', section });
    }
  }
  const active = db.prepare(
    `SELECT path, mode, section FROM file_claim WHERE tile_id = ? AND released_at IS NULL ORDER BY path, mode, section`
  ).all(tileId);
  const sortedDesired = desired.slice().sort((a, b) =>
    (a.path + a.mode + a.section).localeCompare(b.path + b.mode + b.section)
  );
  if (JSON.stringify(active) === JSON.stringify(sortedDesired)) {
    return { released: 0, declared: 0 };
  }

  const release = db.prepare(
    `UPDATE file_claim SET released_at = ? WHERE tile_id = ? AND released_at IS NULL`
  ).run(ts, tileId);
  let declared = 0;
  for (const f of sortedDesired) {
    const path = normalizeClaimPath(repoPath, f.path);
    if (!path) continue;
    db.prepare(
      `INSERT INTO file_claim (id, workspace_id, tile_id, path, mode, section, created_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newClaimId(), workspaceId, tileId, path, f.mode, f.section, ts, ts);
    declared += 1;
  }
  return { released: Number(release.changes), declared };
}

function markMissingPollyItemsCancelled(db, { workspaceId, channel, daemonTileId, seenOwnerIds, ts, correlation_id }) {
  const changed_tasks = [];
  let claims_released = 0;
  const rows = db.prepare(
    `SELECT * FROM task WHERE workspace_id = ? AND channel = ? AND status NOT IN ('done', 'cancelled')`
  ).all(workspaceId, channel);
  for (const row of rows) {
    if (seenOwnerIds.has(row.owner_tile_id)) continue;
    db.prepare(
      `UPDATE task SET status='cancelled', blocker=?, result_summary=?, version=?, updated_at=? WHERE id=?`
    ).run('Missing from latest Polly registry snapshot', 'Polly item removed from registry snapshot', row.version + 1, ts, row.id);
    const release = db.prepare(
      `UPDATE file_claim SET released_at = ? WHERE tile_id = ? AND released_at IS NULL`
    ).run(ts, row.owner_tile_id);
    claims_released += Number(release.changes);
    changed_tasks.push(row.id);
    audit(db, {
      workspace_id: workspaceId,
      actor_type: 'integration',
      actor_id: daemonTileId,
      tile_id: row.owner_tile_id,
      event_type: 'polly_item_stale',
      entity_type: 'task',
      entity_id: row.id,
      correlation_id: correlation_id ?? null,
      payload: { source: 'polly', channel },
      created_at: ts,
    });
  }
  return { changed_tasks, claims_released };
}

function latestPollyActionRequest(db, workspaceId, requestId) {
  const row = db.prepare(
    `SELECT * FROM audit_event
      WHERE workspace_id = ? AND event_type = 'polly_action_requested' AND entity_id = ?
      ORDER BY sequence DESC LIMIT 1`
  ).get(workspaceId, requestId);
  return row ? parseJson(row.payload_json, null) : null;
}

function summarizePollyActionRows(rows, filter = {}) {
  const byId = new Map();
  let last_sequence = Number(filter.since_sequence || 0);
  for (const row of rows) {
    last_sequence = Math.max(last_sequence, Number(row.sequence || 0));
    const payload = parseJson(row.payload_json, null);
    if (!payload?.request_id) continue;
    const current = byId.get(payload.request_id) || { results: [] };
    if (row.event_type === 'polly_action_requested') {
      Object.assign(current, {
        sequence: row.sequence,
        request_id: payload.request_id,
        registry_path: payload.registry_path,
        registry_hash: payload.registry_hash,
        item_id: payload.item_id,
        action: payload.action,
        reason: payload.reason ?? null,
        payload: payload.payload ?? {},
        requested_by_tile_id: payload.requested_by_tile_id ?? null,
        created_at: row.created_at,
      });
    } else if (row.event_type === 'polly_action_result') {
      current.results.push({
        sequence: row.sequence,
        status: payload.status,
        message: payload.message ?? null,
        payload: payload.payload ?? {},
        handled_by_tile_id: payload.handled_by_tile_id ?? null,
        created_at: row.created_at,
      });
    }
    byId.set(payload.request_id, current);
  }
  const requests = [...byId.values()]
    .filter((request) => request.request_id)
    .map((request) => {
      const latest = request.results[request.results.length - 1] || null;
      return {
        ...request,
        status: latest?.status || 'requested',
        result: latest,
      };
    })
    .filter((request) => {
      if (filter.registry_path && request.registry_path !== filter.registry_path) return false;
      if (filter.registry_hash && request.registry_hash !== filter.registry_hash) return false;
      if (filter.item_id && request.item_id !== filter.item_id) return false;
      if (filter.action && request.action !== filter.action) return false;
      if (filter.status && request.status !== filter.status) return false;
      if (filter.pending_only && !['requested', 'accepted'].includes(request.status)) return false;
      return true;
    });
  return { requests, last_sequence };
}

function resultSummary(metadata) {
  const bits = [`Polly ${metadata.polly_status}`];
  if (metadata.pr != null) bits.push(`PR #${metadata.pr}`);
  if (metadata.branch) bits.push(metadata.branch);
  return bits.join(' · ');
}

function attentionText(item, status) {
  if (status === 'READY_FOR_HUMAN_MERGE') return `${item.id} is ready for human merge.`;
  if (item.blockedOn) return `${item.id} is blocked: ${item.blockedOn}`;
  return `${item.id} needs human attention.`;
}

function mapPollyTask(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    channel: row.channel,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    owner_tile_id: row.owner_tile_id,
    creator_tile_id: row.creator_tile_id,
    blocker: row.blocker,
    result_summary: row.result_summary,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}
