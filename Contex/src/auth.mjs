// -------- bearer auth --------
// Round 1 uses a single workspace-owner bearer token, generated at server
// startup (or injected by a launcher) and held ONLY in memory. The token is
// never written to SQLite or any tracked file — the recovered history showed
// live bearer tokens leaking into version control, and EVIDENCE.md calls this
// out explicitly as a thing the rebuild must not repeat.
//
// Scoped, multi-token auth (workspace:read, tile:state, message:send, ...) is a
// later phase; see PROGRESS.md.

import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createToken() {
  return randomBytes(24).toString('hex');
}

// Constant-time comparison so token checks don't leak length/prefix via timing.
export function tokenMatches(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Pull a bearer token out of an Authorization header. Returns null when absent
// or malformed (caller turns that into CONTEXT_AUTH_REQUIRED).
export function parseBearer(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
