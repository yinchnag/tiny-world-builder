// -------- workspace --------
import { newWorkspaceId } from '../ids.mjs';
import { nowIso, audit, parseJson } from '../store.mjs';

export function createWorkspace(db, { name, repository_path = null, settings = null } = {}, opts = {}) {
  const { clock } = opts;
  const id = newWorkspaceId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO workspace (id, name, repository_path, created_at, updated_at, revision, settings_json)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, name ?? 'workspace', repository_path, ts, ts, settings ? JSON.stringify(settings) : null);
  audit(db, { workspace_id: id, actor_type: 'system', event_type: 'workspace_created', entity_type: 'workspace', entity_id: id, created_at: ts });
  return getWorkspace(db, id);
}

export function getWorkspace(db, id) {
  const row = db.prepare(`SELECT * FROM workspace WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, settings: parseJson(row.settings_json, {}) };
}

// Returns the single workspace if exactly one exists (the common local case),
// otherwise null. Lets clients omit workspace_id in a single-repo install.
export function soleWorkspace(db) {
  const rows = db.prepare(`SELECT * FROM workspace WHERE archived_at IS NULL`).all();
  return rows.length === 1 ? { ...rows[0], settings: parseJson(rows[0].settings_json, {}) } : null;
}

export function listWorkspaces(db, { includeArchived = false } = {}) {
  const rows = db
    .prepare(`SELECT * FROM workspace ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at ASC`)
    .all();
  return rows.map((r) => ({ ...r, settings: parseJson(r.settings_json, {}) }));
}

export function archiveWorkspace(db, id, { clock } = {}) {
  const ws = getWorkspace(db, id);
  if (!ws) return null;
  const ts = nowIso(clock);
  db.prepare(`UPDATE workspace SET archived_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  audit(db, { workspace_id: id, actor_type: 'system', event_type: 'workspace_archived', entity_type: 'workspace', entity_id: id, created_at: ts });
  return getWorkspace(db, id);
}

// Live tile count for a workspace (online + offline, not closed).
export function activeTileCount(db, workspaceId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM tile WHERE workspace_id = ? AND closed_at IS NULL`).get(workspaceId).n;
}

// Workspace-level peer discovery is opt-in (FUNCTIONAL_SPEC.md 4.4): discovery
// defaults to directly-linked tiles; enabling this exposes all tiles to
// include_workspace requests.
export function setWorkspaceDiscovery(db, id, enabled, { clock } = {}) {
  const ws = getWorkspace(db, id);
  if (!ws) return null;
  const settings = { ...ws.settings, workspace_discovery: !!enabled };
  db.prepare(`UPDATE workspace SET settings_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(settings), nowIso(clock), id);
  return getWorkspace(db, id);
}

export function workspaceDiscoveryEnabled(db, id) {
  const ws = getWorkspace(db, id);
  return !!(ws && ws.settings && ws.settings.workspace_discovery);
}
