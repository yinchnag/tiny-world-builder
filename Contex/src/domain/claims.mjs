// -------- file claims: path safety + lifecycle --------
// Claims are published through tile state (peer_set_state files[]). This module
// owns the security-sensitive parts Phase 6 calls for: normalizing a claim path
// relative to the workspace repository and rejecting anything that escapes the
// root, plus owner-override release and expiry of stale claims.
//
// Contex never reads file contents to create a claim — a claim is just a label.

import { posix } from 'node:path';
import { nowIso, audit } from '../store.mjs';
import { err } from '../errors.mjs';

// Normalize `input` to a workspace-relative posix path. Rejects traversal
// (`../`) and absolute paths that fall outside the configured repository root.
export function normalizeClaimPath(repoPath, input) {
  const raw = String(input);
  const wasAbsolute = /^([a-zA-Z]:)?[\\/]/.test(raw);
  let p = raw.replace(/\\/g, '/');
  const root = repoPath ? String(repoPath).replace(/\\/g, '/').replace(/\/+$/, '') : null;

  if (root) {
    if (p === root) return '';
    if (p.startsWith(root + '/')) p = p.slice(root.length + 1);
    else if (wasAbsolute) throw err.badRequest(`claim path escapes workspace root: ${input}`);
  }
  p = p.replace(/^\/+/, '');
  const norm = posix.normalize(p);
  if (norm === '..' || norm.startsWith('../')) throw err.badRequest(`claim path escapes workspace root: ${input}`);
  return norm === '.' ? '' : norm.replace(/^\.\//, '');
}

// Release a tile's claim(s) — owner override or self-release. With a path,
// releases just that claim; without, releases all of the tile's active claims.
// Returns the number released.
export function releaseClaim(db, { tile_id, path }, opts = {}) {
  const { clock, correlation_id } = opts;
  const ts = nowIso(clock);
  const info = path
    ? db.prepare(`UPDATE file_claim SET released_at = ? WHERE tile_id = ? AND path = ? AND released_at IS NULL`).run(ts, tile_id, path)
    : db.prepare(`UPDATE file_claim SET released_at = ? WHERE tile_id = ? AND released_at IS NULL`).run(ts, tile_id);
  const released = Number(info.changes);
  if (released > 0) {
    const workspace_id = db.prepare('SELECT workspace_id FROM tile WHERE id = ?').get(tile_id)?.workspace_id ?? null;
    audit(db, { workspace_id, actor_type: 'owner', actor_id: tile_id, tile_id, event_type: 'claim_released', entity_type: 'file_claim', correlation_id: correlation_id ?? null, payload: { path: path ?? 'all', count: released }, created_at: ts });
  }
  return released;
}

// Release claims whose expires_at has passed. Returns the number expired.
export function purgeExpiredClaims(db, { clock } = {}) {
  const now = nowIso(clock);
  const info = db
    .prepare(`UPDATE file_claim SET released_at = ? WHERE released_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?`)
    .run(now, now);
  return Number(info.changes);
}

// A claim counts for conflict derivation only if it hasn't expired.
export function isClaimLive(claim, nowMs) {
  if (claim.expires_at == null) return true;
  return Date.parse(claim.expires_at) > nowMs;
}
