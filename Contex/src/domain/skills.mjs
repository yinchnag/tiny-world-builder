// -------- skills: per-tile enable/disable --------
// A tile enables/disables skills from a source (local/user/plugin). Mirrors the
// recovered skills.json ({ enabled: [], disabled: [] }).

import { newSkillId } from '../ids.mjs';
import { nowIso, parseJson } from '../store.mjs';
import { err } from '../errors.mjs';

export function setSkill(db, { tile_id, skill_key, enabled = true, source = 'local', metadata = null }, { clock } = {}) {
  if (!tile_id || !skill_key) throw err.badRequest('tile_id and skill_key are required');
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO skill_assignment (id, tile_id, skill_key, source, enabled, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tile_id, skill_key) DO UPDATE SET
       enabled = excluded.enabled, source = excluded.source, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`
  ).run(newSkillId(), tile_id, skill_key, source, enabled ? 1 : 0, metadata ? JSON.stringify(metadata) : null, ts, ts);
  return getSkill(db, tile_id, skill_key);
}

export function getSkill(db, tileId, skillKey) {
  const r = db.prepare(`SELECT * FROM skill_assignment WHERE tile_id = ? AND skill_key = ?`).get(tileId, skillKey);
  return r ? mapSkill(r) : null;
}

export function listSkillAssignments(db, tileId) {
  return db.prepare(`SELECT * FROM skill_assignment WHERE tile_id = ? ORDER BY skill_key ASC`).all(tileId).map(mapSkill);
}

// skills.json shape ({ enabled: [], disabled: [] }) for the virtual file/resource.
export function skillsJson(db, tileId) {
  const all = listSkillAssignments(db, tileId);
  return {
    enabled: all.filter((s) => s.enabled).map((s) => s.skill_key),
    disabled: all.filter((s) => !s.enabled).map((s) => s.skill_key),
  };
}

function mapSkill(r) {
  return { skill_key: r.skill_key, source: r.source, enabled: !!r.enabled, metadata: parseJson(r.metadata_json, null) };
}
