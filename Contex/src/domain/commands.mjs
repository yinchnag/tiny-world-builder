// -------- canvas command bus --------
// Agents request canvas actions (create a tile, send terminal input, focus/
// highlight/connect); Contex queues them, CodeSurf consumes them and reports a
// result. Lifecycle: accepted -> delivered -> completed | failed | expired.
//
// Contex is just the queue + lifecycle. It validates safety (terminal-input
// capability/permission) but never drives a UI or a PTY itself.

import { newCommandId } from '../ids.mjs';
import { nowIso, audit, parseJson } from '../store.mjs';
import { err } from '../errors.mjs';

const TERMINAL_STATES = new Set(['completed', 'failed', 'expired']);

export function enqueueCommand(db, { workspace_id, requester_tile_id = null, target_tile_id = null, kind, payload = null }, opts = {}) {
  const { clock, correlation_id } = opts;
  const id = newCommandId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO canvas_command (id, workspace_id, requester_tile_id, target_tile_id, kind, payload_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)`
  ).run(id, workspace_id, requester_tile_id, target_tile_id, kind, payload ? JSON.stringify(payload) : null, ts);
  audit(db, {
    workspace_id, actor_type: 'tile', actor_id: requester_tile_id, tile_id: target_tile_id,
    event_type: 'canvas_command_enqueued', entity_type: 'command', entity_id: id,
    correlation_id: correlation_id ?? null, payload: { kind }, created_at: ts,
  });
  return getCommand(db, id);
}

export function getCommand(db, id) {
  const r = db.prepare(`SELECT * FROM canvas_command WHERE id = ?`).get(id);
  return r ? mapCommand(r) : null;
}

export function listCommands(db, workspaceId) {
  return db.prepare(`SELECT * FROM canvas_command WHERE workspace_id = ? ORDER BY created_at ASC`).all(workspaceId).map(mapCommand);
}

// Consumer (CodeSurf) pulls pending commands. Returns accepted + already-
// delivered (not-yet-finished) commands — delivery is at-least-once, so the
// consumer must tolerate seeing a command twice; completion is idempotent.
export function nextCommands(db, workspaceId, { limit = 20, clock } = {}) {
  const rows = db
    .prepare(`SELECT * FROM canvas_command WHERE workspace_id = ? AND status IN ('accepted','delivered') ORDER BY created_at ASC LIMIT ?`)
    .all(workspaceId, limit);
  const ts = nowIso(clock);
  for (const r of rows) {
    if (r.status === 'accepted') db.prepare(`UPDATE canvas_command SET status='delivered', delivered_at=? WHERE id=?`).run(ts, r.id);
  }
  return rows.map((r) => getCommand(db, r.id));
}

// Consumer reports the outcome. Idempotent: a second completion is a no-op.
export function completeCommand(db, { command_id, result = null, error = null }, opts = {}) {
  const { clock, correlation_id } = opts;
  const r = db.prepare(`SELECT * FROM canvas_command WHERE id = ?`).get(command_id);
  if (!r) throw err.badRequest(`Unknown command: ${command_id}`);
  if (TERMINAL_STATES.has(r.status)) return mapCommand(r);
  const ts = nowIso(clock);
  const status = error ? 'failed' : 'completed';
  db.prepare(`UPDATE canvas_command SET status=?, result_json=?, error=?, completed_at=? WHERE id=?`)
    .run(status, result ? JSON.stringify(result) : null, error, ts, command_id);
  audit(db, {
    workspace_id: r.workspace_id, actor_type: 'canvas', tile_id: r.target_tile_id,
    event_type: 'canvas_command_completed', entity_type: 'command', entity_id: command_id,
    correlation_id: correlation_id ?? null, payload: { status }, created_at: ts,
  });
  return getCommand(db, command_id);
}

// Expire commands that were never finished within the window (canvas offline /
// timeout). Returns the number expired.
export function expireStaleCommands(db, { olderThanMs = 24 * 3600 * 1000, clock } = {}) {
  const cutoff = new Date((clock ? clock() : Date.now()) - olderThanMs).toISOString();
  const info = db
    .prepare(`UPDATE canvas_command SET status='expired' WHERE status IN ('accepted','delivered') AND created_at < ?`)
    .run(cutoff);
  return Number(info.changes);
}

function mapCommand(r) {
  return {
    id: r.id, workspace_id: r.workspace_id, requester_tile_id: r.requester_tile_id, target_tile_id: r.target_tile_id,
    kind: r.kind, payload: parseJson(r.payload_json, null), status: r.status,
    result: parseJson(r.result_json, null), error: r.error,
    created_at: r.created_at, delivered_at: r.delivered_at, completed_at: r.completed_at,
  };
}
