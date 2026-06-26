// -------- objectives: versioned instructions + reload signaling --------
// Each objective update stores an immutable new version (DATA_MODEL.md
// ObjectiveVersion). The current version is never overwritten — instead the
// agent is signalled to reload and must acknowledge the version it picked up.
// A tile needs a reload whenever the latest version > its acknowledged version.

import { newObjectiveId } from '../ids.mjs';
import { nowIso, audit, parseJson } from '../store.mjs';
import { err } from '../errors.mjs';

export function setObjective(db, { tile_id, markdown = '', rules = null, generated_by = null, workspace_id = null }, { clock } = {}) {
  if (!tile_id) throw err.badRequest('tile_id is required');
  const version = latestVersion(db, tile_id) + 1;
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO objective_version (id, workspace_id, tile_id, version, markdown, rules_json, generated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(newObjectiveId(), workspace_id, tile_id, version, markdown, rules ? JSON.stringify(rules) : null, generated_by, ts);
  audit(db, {
    workspace_id, actor_type: 'canvas', tile_id, event_type: 'objective_updated',
    entity_type: 'objective', entity_id: tile_id, payload: { version }, created_at: ts,
  });
  return getObjective(db, tile_id);
}

export function latestVersion(db, tileId) {
  return db.prepare(`SELECT MAX(version) AS v FROM objective_version WHERE tile_id = ?`).get(tileId).v ?? 0;
}

export function getObjective(db, tileId) {
  const row = db.prepare(`SELECT * FROM objective_version WHERE tile_id = ? ORDER BY version DESC LIMIT 1`).get(tileId);
  if (!row) return null;
  return { tile_id: tileId, version: row.version, markdown: row.markdown, rules: parseJson(row.rules_json, []), generated_by: row.generated_by, created_at: row.created_at };
}

export function objectiveVersions(db, tileId) {
  return db.prepare(`SELECT version, created_at, generated_by FROM objective_version WHERE tile_id = ? ORDER BY version ASC`).all(tileId);
}

export function ackedVersion(db, tileId) {
  return db.prepare(`SELECT version FROM objective_ack WHERE tile_id = ?`).get(tileId)?.version ?? 0;
}

export function objectiveReloadRequired(db, tileId) {
  return latestVersion(db, tileId) > ackedVersion(db, tileId);
}

// Record acknowledgement of an objective version. Acking an older version while
// a newer one exists is allowed but reported as stale (reload still required).
export function acknowledgeObjective(db, { tile_id, version }, { clock } = {}) {
  const latest = latestVersion(db, tile_id);
  if (latest === 0) throw err.badRequest(`tile has no objective: ${tile_id}`);
  const ackVer = version ?? latest;
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO objective_ack (tile_id, version, acknowledged_at) VALUES (?, ?, ?)
     ON CONFLICT(tile_id) DO UPDATE SET version = excluded.version, acknowledged_at = excluded.acknowledged_at`
  ).run(tile_id, ackVer, ts);
  return { tile_id, acknowledged_version: ackVer, latest_version: latest, stale: ackVer < latest, reload_required: ackVer < latest };
}

// reload_objective: fetch the latest objective and acknowledge its version.
export function reloadObjective(db, { tile_id }, opts = {}) {
  const obj = getObjective(db, tile_id);
  if (!obj) throw err.badRequest(`tile has no objective: ${tile_id}`);
  acknowledgeObjective(db, { tile_id, version: obj.version }, opts);
  return { ...obj, reload_required: false };
}
