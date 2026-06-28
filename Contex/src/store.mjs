// -------- store helpers --------
// Thin cross-cutting helpers shared by the domain modules: a clock, the
// append-only audit writer, and the idempotency cache. Entity-specific access
// + business rules live in src/domain/*.

export function nowIso(clock) {
  return new Date(clock ? clock() : Date.now()).toISOString();
}

// Append-only audit. Every state change goes through here so the workspace can
// be replayed / recovered (see DATA_MODEL.md AuditEvent).
export function audit(db, ev) {
  db.prepare(
    `INSERT INTO audit_event
       (workspace_id, actor_type, actor_id, tile_id, event_type, entity_type, entity_id, correlation_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ev.workspace_id ?? null,
    ev.actor_type ?? 'tile',
    ev.actor_id ?? null,
    ev.tile_id ?? null,
    ev.event_type,
    ev.entity_type ?? null,
    ev.entity_id ?? null,
    ev.correlation_id ?? null,
    ev.payload != null ? JSON.stringify(ev.payload) : null,
    ev.created_at
  );
}

export function listAudit(db, workspaceId, limit = 100) {
  return db
    .prepare(`SELECT * FROM audit_event WHERE workspace_id = ? ORDER BY sequence DESC LIMIT ?`)
    .all(workspaceId, limit)
    .map(safeAuditRow);
}

// Forward-scanning feed for Workspace Memory: returns events with sequence >
// since_sequence in ascending order so the consumer can checkpoint its position.
export function listAuditFeed(db, workspaceId, { since_sequence = 0, limit = 100 } = {}) {
  return db
    .prepare(`SELECT * FROM audit_event WHERE workspace_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`)
    .all(workspaceId, since_sequence, limit)
    .map(safeAuditRow);
}

// Human/CodeSurf-facing timeline over audit events. It keeps the append-only
// audit rows intact in `payload`, but adds stable category + summary fields so
// UIs do not have to know every low-level event shape.
export function listTimeline(db, workspaceId, { tile_id = null, since_sequence = 0, limit = 100 } = {}) {
  const scanLimit = tile_id ? Math.max(limit * 5, 100) : limit;
  const rows = listAuditFeed(db, workspaceId, { since_sequence, limit: scanLimit });
  const filtered = tile_id ? rows.filter((row) => timelineMatchesTile(row, tile_id)) : rows;
  return filtered.slice(0, limit).map(timelineItem);
}

// Parse payload_json safely so a corrupted row never crashes a reader.
function safeAuditRow(row) {
  let payload = null;
  if (row.payload_json != null) {
    try { payload = JSON.parse(row.payload_json); } catch { payload = { _raw: row.payload_json, _error: 'parse_failed' }; }
  }
  return { ...row, payload };
}

function timelineMatchesTile(row, tileId) {
  if (row.actor_id === tileId || row.tile_id === tileId) return true;
  const p = row.payload || {};
  if (p.from === tileId || p.to === tileId) return true;
  if (p.owner_tile_id === tileId || p.creator_tile_id === tileId) return true;
  if (p.assignee === tileId || p.source_tile_id === tileId || p.target_tile_id === tileId) return true;
  return false;
}

function timelineItem(row) {
  return {
    sequence: row.sequence,
    created_at: row.created_at,
    category: timelineCategory(row),
    event_type: row.event_type,
    actor_id: row.actor_id,
    tile_id: row.tile_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    correlation_id: row.correlation_id,
    summary: timelineSummary(row),
    payload: row.payload,
  };
}

function timelineCategory(row) {
  if (row.event_type.startsWith('tile_')) return 'status';
  if (row.event_type.startsWith('message_')) return 'message';
  if (row.event_type.startsWith('task_') || row.event_type.startsWith('todo_')) return 'task';
  if (row.event_type.startsWith('peer_link_')) return 'link';
  if (row.event_type === 'notification') return 'notification';
  if (row.event_type.startsWith('canvas_command_')) return 'command';
  if (row.event_type.startsWith('polly_')) return 'integration';
  return 'audit';
}

function timelineSummary(row) {
  const p = row.payload || {};
  if (row.event_type === 'tile_state_changed') {
    return `${row.tile_id || row.actor_id} is ${p.status || 'updated'}${p.task ? `: ${p.task}` : ''}`;
  }
  if (row.event_type === 'tile_reconnected') return `${row.tile_id || row.actor_id} reconnected`;
  if (row.event_type === 'message_sent') return `${p.from || row.actor_id} -> ${p.to || row.tile_id}`;
  if (row.event_type === 'task_created') return `Task created: ${p.title || row.entity_id}`;
  if (row.event_type === 'task_updated') {
    const owner = p.owner_tile_id ? ` assigned to ${p.owner_tile_id}` : '';
    return `Task ${row.entity_id} ${p.status || 'updated'}${owner}`;
  }
  if (row.event_type === 'todo_assigned') return `Todo assigned: ${p.title || row.entity_id}`;
  if (row.event_type === 'todo_completed') return `Todo completed: ${row.entity_id}`;
  if (row.event_type === 'peer_link_changed') return `Link ${p.action || 'changed'}: ${p.source_tile_id} -> ${p.target_tile_id}`;
  if (row.event_type === 'notification') return p.text || 'Notification';
  return row.event_type;
}

// -------- idempotency --------
export function getIdempotent(db, key) {
  if (!key) return null;
  const row = db.prepare(`SELECT response_json FROM idempotency WHERE key = ?`).get(key);
  return row ? JSON.parse(row.response_json) : null;
}

export function putIdempotent(db, key, tool, response, createdAt) {
  if (!key) return;
  db.prepare(
    `INSERT OR IGNORE INTO idempotency (key, tool, response_json, created_at) VALUES (?, ?, ?, ?)`
  ).run(key, tool, JSON.stringify(response), createdAt);
}

// -------- operational metrics --------
// Lightweight DB-backed counters for the GET /metrics endpoint.
// All values are point-in-time counts — no runtime accumulation needed.
export function getDbMetrics(db, { heartbeatTimeoutMs = 30_000 } = {}) {
  const activeWorkspaces = db.prepare(`SELECT COUNT(*) AS n FROM workspace WHERE archived_at IS NULL`).get().n;
  const tilesTotal = db.prepare(`SELECT COUNT(*) AS n FROM tile WHERE closed_at IS NULL`).get().n;
  const cutoff = new Date(Date.now() - heartbeatTimeoutMs).toISOString();
  const tilesOnline = db.prepare(
    `SELECT COUNT(*) AS n FROM tile WHERE closed_at IS NULL AND last_seen_at > ? AND status != 'offline'`
  ).get(cutoff).n;
  const unreadMessages = db.prepare(`SELECT COUNT(*) AS n FROM message WHERE read_at IS NULL`).get().n;
  const pendingCommands = db.prepare(`SELECT COUNT(*) AS n FROM canvas_command WHERE status = 'accepted'`).get().n;
  const auditTotal = db.prepare(`SELECT COUNT(*) AS n FROM audit_event`).get().n;
  return { workspaces: activeWorkspaces, tiles: { total: tilesTotal, online: tilesOnline }, messages: { unread: unreadMessages }, commands: { pending: pendingCommands }, audit: { total: auditTotal } };
}

// JSON column helpers — tolerate null + malformed without throwing.
export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
