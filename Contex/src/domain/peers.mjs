// -------- peers: discovery + file-conflict derivation --------
// peer_get_state assembles a tile's view of the world: its own normalized
// state, the linked peers it can see (with the tools each peer type exposes),
// and any file-claim conflicts in that neighborhood.
//
// Conflicts are DERIVED from live claims, never persisted as truth
// (DATA_MODEL.md section 5). Contex reports them; it never touches files.

import { getTile, getTileRow, normalizeTile, activeClaimsForTile, effectiveStatus, DEFAULT_HEARTBEAT_TIMEOUT_MS } from './tiles.mjs';
import { linkedTileIds, canActOn } from './links.mjs';
import { workspaceDiscoveryEnabled } from './workspace.mjs';
import { isClaimLive } from './claims.mjs';
import { err } from '../errors.mjs';

// Tools a peer of a given type exposes to a linked neighbor. Mirrors the
// recovered peers.md (terminal -> terminal input; chat -> send/acknowledge) and
// MCP_API.md. Every linked peer can additionally be messaged via peer_send_message.
export function availableToolsForType(type) {
  switch (type) {
    case 'terminal': return ['terminal_send_input'];
    case 'chat': return ['chat_send_message', 'chat_acknowledge'];
    default: return [];
  }
}

// -------- conflict matrix --------
// read/read -> none; read/edit -> info; edit/edit -> warning; exclusive/* -> blocking.
export function deriveConflicts(claims) {
  const byPath = new Map();
  for (const c of claims) {
    if (!byPath.has(c.path)) byPath.set(c.path, new Map());
    // keep one mode per tile per path (strongest wins: exclusive > edit > read)
    const perTile = byPath.get(c.path);
    perTile.set(c.tile_id, strongestMode(perTile.get(c.tile_id), c.mode));
  }
  const conflicts = [];
  for (const [path, perTile] of byPath) {
    if (perTile.size < 2) continue; // a single tile can't conflict with itself
    const claimants = [...perTile.entries()].map(([tile_id, mode]) => ({ tile_id, mode }));
    const modes = claimants.map((c) => c.mode);
    const hasExclusive = modes.includes('exclusive');
    const editors = modes.filter((m) => m === 'edit').length;
    const hasEdit = editors > 0;
    const hasRead = modes.includes('read');

    let severity = null;
    if (hasExclusive) severity = 'blocking';
    else if (editors >= 2) severity = 'warning';
    else if (hasEdit && hasRead) severity = 'info';
    if (!severity) continue; // read/read only

    conflicts.push({
      path,
      claimants,
      severity,
      recommended_action: severity === 'info' ? 'notify' : 'coordinate',
    });
  }
  return conflicts.sort((a, b) => a.path.localeCompare(b.path));
}

function strongestMode(a, b) {
  const rank = { read: 1, edit: 2, exclusive: 3 };
  if (!a) return b;
  return (rank[b] || 0) > (rank[a] || 0) ? b : a;
}

// -------- peer_get_state --------
export function getPeerState(db, { tile_id, include_workspace = false, include_offline = false }, opts = {}) {
  const now = opts.now ?? Date.now();
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const normOpts = { now, heartbeatTimeoutMs };

  const selfRow = getTileRow(db, tile_id);
  if (!selfRow) throw err.tileNotFound(tile_id);
  const self = normalizeTile(selfRow, normOpts);

  let peerIds;
  if (include_workspace) {
    // workspace-wide discovery is opt-in per workspace
    if (!workspaceDiscoveryEnabled(db, selfRow.workspace_id)) {
      throw err.scopeDenied('Workspace-wide discovery is not enabled for this workspace');
    }
    peerIds = db
      .prepare(`SELECT id FROM tile WHERE workspace_id = ? AND id != ? AND closed_at IS NULL`)
      .all(selfRow.workspace_id, tile_id)
      .map((r) => r.id);
  } else {
    peerIds = linkedTileIds(db, selfRow.workspace_id, tile_id);
  }

  // claims only count for conflicts when their owning tile is online and the
  // claim hasn't expired — a stale (offline/expired) claim must not block.
  const liveClaims = (id, online) => (online ? activeClaimsForTile(db, id).filter((c) => isClaimLive(c, now)) : []);

  const peers = [];
  const conflictScopeClaims = [...liveClaims(tile_id, self.online)];
  for (const pid of peerIds) {
    const row = getTileRow(db, pid);
    if (!row) continue;
    const norm = normalizeTile(row, normOpts);
    if (!include_offline && !norm.online) continue;
    // peer is visible (undirected); tools are listed only if THIS tile may act on it
    const tools = canActOn(db, selfRow.workspace_id, tile_id, pid) ? availableToolsForType(row.type) : [];
    peers.push({ ...norm, available_tools: tools });
    conflictScopeClaims.push(...liveClaims(pid, norm.online));
  }

  return {
    tile: self,
    peers,
    conflicts: deriveConflicts(conflictScopeClaims),
  };
}
