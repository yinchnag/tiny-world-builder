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
    .all(workspaceId, limit);
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

// JSON column helpers — tolerate null + malformed without throwing.
export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
