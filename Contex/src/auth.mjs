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

// -------- scoped token store (Phase 12) --------
// Maps token strings -> { scopes: Set<string>, expiresAt: number|null, label: string }.
// The master token is immutable and always has ['*'] scope.
// Client tokens are issued with a restricted scope set (e.g. ['agent']).
export function createTokenStore(masterToken) {
  const store = new Map();
  store.set(masterToken, { scopes: new Set(['*']), expiresAt: null, label: 'master' });

  return {
    // Authenticate: returns the entry or null (absent / expired).
    authenticate(provided) {
      if (typeof provided !== 'string') return null;
      const entry = store.get(provided);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(provided);
        return null;
      }
      return entry;
    },

    // Issue a new client token.
    issue({ scopes = ['agent'], ttlSeconds = null, label = '' } = {}) {
      const token = createToken();
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      const scopeSet = new Set(Array.isArray(scopes) ? scopes : [scopes]);
      store.set(token, { scopes: scopeSet, expiresAt, label: String(label) });
      return {
        token,
        scopes: [...scopeSet],
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        label: String(label),
      };
    },

    // Revoke a non-master token by value. Returns true if found and removed.
    revoke(provided) {
      if (typeof provided !== 'string' || provided === masterToken) return false;
      return store.delete(provided);
    },

    // List active non-master tokens (prefix only — never return full value).
    list() {
      const result = [];
      const now = Date.now();
      for (const [t, e] of store) {
        if (t === masterToken) continue;
        if (e.expiresAt && now > e.expiresAt) continue;
        result.push({
          token_prefix: t.slice(0, 8) + '...',
          scopes: [...e.scopes],
          expires_at: e.expiresAt ? new Date(e.expiresAt).toISOString() : null,
          label: e.label,
        });
      }
      return result;
    },

    // True when an auth entry carries admin (*) or admin scope.
    isAdmin(entry) {
      return !!(entry?.scopes?.has('*') || entry?.scopes?.has('admin'));
    },
  };
}
