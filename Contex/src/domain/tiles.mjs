// -------- tiles: presence, state machine, optimistic concurrency, claims --------
import { newClaimId } from '../ids.mjs';
import { nowIso, audit, parseJson } from '../store.mjs';
import { err } from '../errors.mjs';

export const TILE_TYPES = new Set([
  'terminal', 'chat', 'document', 'browser', 'extension', 'status', 'memory', 'unknown',
]);

export const TILE_STATUSES = new Set([
  'offline', 'idle', 'working', 'waiting', 'blocked', 'paused', 'done', 'error',
]);

export const CLAIM_MODES = new Set(['read', 'edit', 'exclusive']);

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

// Tile state machine (DATA_MODEL.md section 3). A brand-new registration is
// modeled as a transition out of `offline`. `offline` is always reachable
// (explicit or heartbeat timeout).
const TRANSITIONS = {
  offline: ['idle', 'working'],
  idle: ['idle', 'working', 'offline'],
  working: ['working', 'waiting', 'blocked', 'paused', 'done', 'error', 'idle', 'offline'],
  waiting: ['working', 'blocked', 'paused', 'error', 'idle', 'offline'],
  blocked: ['working', 'paused', 'error', 'idle', 'offline'],
  paused: ['working', 'blocked', 'idle', 'offline'],
  done: ['working', 'idle', 'offline'],
  error: ['working', 'idle', 'offline'],
};

export function isValidTransition(from, to) {
  if (!TILE_STATUSES.has(to)) return false;
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

// -------- peer_set_state --------
// Register a tile or update its presence. Enforces the status machine and
// optimistic concurrency (expected_version), then syncs file claims when a
// `files` array is supplied. Returns the normalized tile (with new version).
export function setTileState(db, input, { clock, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
  const tileId = input.tile_id;
  if (!tileId) throw err.badRequest('tile_id is required');
  if (input.tile_type && !TILE_TYPES.has(input.tile_type)) {
    throw err.badRequest(`Unknown tile_type: ${input.tile_type}`);
  }
  const ts = nowIso(clock);
  const now = clock ? clock() : Date.now();
  const existingRow = db.prepare(`SELECT * FROM tile WHERE id = ?`).get(tileId);
  const requestedStatus = input.status || (existingRow ? existingRow.status : 'idle');
  if (!TILE_STATUSES.has(requestedStatus)) {
    throw err.invalidTransition(existingRow ? existingRow.status : 'offline', requestedStatus);
  }

  if (existingRow) {
    // optimistic concurrency
    if (input.expected_version != null && input.expected_version !== existingRow.version) {
      throw err.versionConflict(input.expected_version, existingRow.version);
    }
    // transition is checked against the EFFECTIVE status (offline if stale)
    const from = effectiveStatus(existingRow, now, heartbeatTimeoutMs);
    if (!isValidTransition(from, requestedStatus)) {
      throw err.invalidTransition(from, requestedStatus);
    }
    const next = {
      type: input.tile_type ?? existingRow.type,
      title: input.title ?? existingRow.title,
      display_name: input.display_name ?? existingRow.display_name,
      status: requestedStatus,
      task: pick(input, 'task', existingRow.task),
      progress: pick(input, 'progress', existingRow.progress),
      summary: pick(input, 'summary', existingRow.summary),
      blocker: pick(input, 'blocker', existingRow.blocker),
      branch: pick(input, 'branch', existingRow.branch),
      worktree: pick(input, 'worktree', existingRow.worktree),
      client_instance_id: input.client_instance_id ?? existingRow.client_instance_id,
      capabilities_json: input.capabilities ? JSON.stringify(input.capabilities) : existingRow.capabilities_json,
      version: existingRow.version + 1,
    };
    db.prepare(
      `UPDATE tile SET type=?, title=?, display_name=?, status=?, task=?, progress=?, summary=?,
         blocker=?, branch=?, worktree=?, client_instance_id=?, capabilities_json=?, version=?,
         last_seen_at=?, updated_at=? WHERE id=?`
    ).run(
      next.type, next.title, next.display_name, next.status, next.task, next.progress, next.summary,
      next.blocker, next.branch, next.worktree, next.client_instance_id, next.capabilities_json,
      next.version, ts, ts, tileId
    );
    // a new client_instance_id on an existing tile = the agent reconnected
    if (input.client_instance_id && existingRow.client_instance_id && input.client_instance_id !== existingRow.client_instance_id) {
      audit(db, {
        workspace_id: input.workspace_id, actor_type: 'tile', actor_id: tileId, tile_id: tileId,
        event_type: 'tile_reconnected', entity_type: 'tile', entity_id: tileId,
        payload: { from: existingRow.client_instance_id, to: input.client_instance_id }, created_at: ts,
      });
    }
  } else {
    // brand-new registration: modeled as offline -> requestedStatus
    if (!isValidTransition('offline', requestedStatus)) {
      throw err.invalidTransition('offline', requestedStatus);
    }
    db.prepare(
      `INSERT INTO tile (id, workspace_id, type, title, display_name, status, task, progress, summary,
         blocker, branch, worktree, client_instance_id, capabilities_json, version, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      tileId, input.workspace_id, input.tile_type ?? 'unknown', input.title ?? null, input.display_name ?? null,
      requestedStatus, input.task ?? null, input.progress ?? null, input.summary ?? null, input.blocker ?? null,
      input.branch ?? null, input.worktree ?? null, input.client_instance_id ?? null,
      input.capabilities ? JSON.stringify(input.capabilities) : null, ts, ts, ts
    );
  }

  // sync claims when files supplied (including an explicit empty array = release all)
  if (Array.isArray(input.files)) {
    syncClaims(db, input.workspace_id, tileId, input.files, ts);
  }

  audit(db, {
    workspace_id: input.workspace_id,
    actor_type: 'tile',
    actor_id: tileId,
    tile_id: tileId,
    event_type: 'tile_state_changed',
    entity_type: 'tile',
    entity_id: tileId,
    payload: { status: requestedStatus, task: input.task ?? null },
    created_at: ts,
  });

  return getTile(db, tileId, { now, heartbeatTimeoutMs });
}

function pick(input, key, current) {
  // distinguish "field omitted" (keep current) from "explicit null" (clear)
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : current;
}

// -------- claims --------
function syncClaims(db, workspaceId, tileId, files, ts) {
  // release this tile's prior active claims, then re-declare from `files`
  db.prepare(`UPDATE file_claim SET released_at = ? WHERE tile_id = ? AND released_at IS NULL`).run(ts, tileId);
  for (const f of files) {
    if (!f || !f.path) continue;
    const mode = CLAIM_MODES.has(f.mode) ? f.mode : 'edit';
    db.prepare(
      `INSERT INTO file_claim (id, workspace_id, tile_id, path, mode, section, created_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newClaimId(), workspaceId, tileId, f.path, mode, f.section ?? null, ts, ts);
  }
}

export function activeClaims(db, workspaceId) {
  return db
    .prepare(`SELECT * FROM file_claim WHERE workspace_id = ? AND released_at IS NULL`)
    .all(workspaceId);
}

export function activeClaimsForTile(db, tileId) {
  return db
    .prepare(`SELECT * FROM file_claim WHERE tile_id = ? AND released_at IS NULL`)
    .all(tileId);
}

// -------- reads / normalization --------
export function effectiveStatus(row, now, heartbeatTimeoutMs) {
  if (row.status === 'offline') return 'offline';
  const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (now - seen > heartbeatTimeoutMs) return 'offline';
  return row.status;
}

export function normalizeTile(row, { now = Date.now(), heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
  if (!row) return null;
  const effective = effectiveStatus(row, now, heartbeatTimeoutMs);
  return {
    tile_id: row.id,
    workspace_id: row.workspace_id,
    type: row.type,
    title: row.title,
    display_name: row.display_name,
    status: effective,
    reported_status: row.status,
    online: effective !== 'offline',
    task: row.task,
    progress: row.progress,
    summary: row.summary,
    blocker: row.blocker,
    branch: row.branch,
    worktree: row.worktree,
    capabilities: parseJson(row.capabilities_json, null),
    version: row.version,
    last_seen_at: row.last_seen_at,
    updated_at: row.updated_at,
  };
}

export function getTile(db, tileId, opts = {}) {
  const row = db.prepare(`SELECT * FROM tile WHERE id = ?`).get(tileId);
  if (!row) throw err.tileNotFound(tileId);
  return normalizeTile(row, opts);
}

export function getTileRow(db, tileId) {
  return db.prepare(`SELECT * FROM tile WHERE id = ?`).get(tileId);
}

export function listTiles(db, workspaceId, opts = {}) {
  return db
    .prepare(`SELECT * FROM tile WHERE workspace_id = ? AND closed_at IS NULL`)
    .all(workspaceId)
    .map((r) => normalizeTile(r, opts));
}
