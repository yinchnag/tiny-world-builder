// -------- tile links (canvas edges) --------
// Links are the runtime peer graph, not just visual decoration: a link's
// existence is what makes two tiles discover each other and grants the
// type-derived communication tools (see FUNCTIONAL_SPEC.md peer graph).
//
// In the full system CodeSurf draws these on the canvas; in Round 1 (no GUI)
// the workspace owner creates them via the `link_tiles` tool / domain API so the
// coordination loop can be exercised headless.

import { newLinkId } from '../ids.mjs';
import { nowIso, audit } from '../store.mjs';

const LINK_KINDS = new Set([
  'collaborates_with', 'reports_to', 'feeds', 'controls', 'observes', 'references',
]);

export function linkTiles(db, { workspace_id, source_tile_id, target_tile_id, kind = 'collaborates_with', directed = false }, { clock } = {}) {
  const k = LINK_KINDS.has(kind) ? kind : 'collaborates_with';
  // Reuse an existing live link between the same pair rather than duplicating.
  const existing = activeLinkBetween(db, workspace_id, source_tile_id, target_tile_id);
  if (existing) return existing;
  const id = newLinkId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO tile_link (id, workspace_id, source_tile_id, target_tile_id, kind, directed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, workspace_id, source_tile_id, target_tile_id, k, directed ? 1 : 0, ts);
  audit(db, { workspace_id, actor_type: 'canvas', event_type: 'peer_link_changed', entity_type: 'link', entity_id: id, payload: { source_tile_id, target_tile_id, kind: k, action: 'created' }, created_at: ts });
  return db.prepare(`SELECT * FROM tile_link WHERE id = ?`).get(id);
}

export function unlinkTiles(db, { workspace_id, source_tile_id, target_tile_id }, { clock } = {}) {
  const ts = nowIso(clock);
  const link = activeLinkBetween(db, workspace_id, source_tile_id, target_tile_id);
  if (!link) return false;
  db.prepare(`UPDATE tile_link SET deleted_at = ? WHERE id = ?`).run(ts, link.id);
  audit(db, { workspace_id, actor_type: 'canvas', event_type: 'peer_link_changed', entity_type: 'link', entity_id: link.id, payload: { source_tile_id, target_tile_id, action: 'deleted' }, created_at: ts });
  return true;
}

function activeLinkBetween(db, workspaceId, a, b) {
  return db
    .prepare(
      `SELECT * FROM tile_link
       WHERE workspace_id = ? AND deleted_at IS NULL
         AND ((source_tile_id = ? AND target_tile_id = ?)
           OR (source_tile_id = ? AND target_tile_id = ?))
       LIMIT 1`
    )
    .get(workspaceId, a, b, b, a);
}

// Tile ids linked to `tileId` (treating links as undirected for discovery —
// directedness only affects which tools flow which way, not visibility).
export function linkedTileIds(db, workspaceId, tileId) {
  const rows = db
    .prepare(
      `SELECT source_tile_id, target_tile_id FROM tile_link
       WHERE workspace_id = ? AND deleted_at IS NULL
         AND (source_tile_id = ? OR target_tile_id = ?)`
    )
    .all(workspaceId, tileId, tileId);
  const ids = new Set();
  for (const r of rows) {
    ids.add(r.source_tile_id === tileId ? r.target_tile_id : r.source_tile_id);
  }
  return [...ids];
}

export function listLinks(db, workspaceId) {
  return db
    .prepare(`SELECT * FROM tile_link WHERE workspace_id = ? AND deleted_at IS NULL`)
    .all(workspaceId);
}

// Can `from` invoke tools on `to`? Visibility is undirected, but tool flow
// respects direction (FUNCTIONAL_SPEC.md: directedness only changes which tools
// flow which way). An undirected link allows both directions; a directed link
// only allows source -> target.
export function canActOn(db, workspaceId, from, to) {
  const rows = db
    .prepare(
      `SELECT source_tile_id, target_tile_id, directed FROM tile_link
       WHERE workspace_id = ? AND deleted_at IS NULL
         AND ((source_tile_id = ? AND target_tile_id = ?)
           OR (source_tile_id = ? AND target_tile_id = ?))`
    )
    .all(workspaceId, from, to, to, from);
  for (const r of rows) {
    if (!r.directed) return true;
    if (r.source_tile_id === from && r.target_tile_id === to) return true;
  }
  return false;
}
