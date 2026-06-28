// -------- structured JSON logger --------
// Writes one JSON line per event to `stream` (default stderr). Fields:
//   ts      — ISO-8601 timestamp
//   level   — debug | info | warn | error
//   event   — short camelCase event name (e.g. "server.start", "tool.call")
//   ...ctx  — additional context fields
//
// NEVER logged: bearer tokens, message text/content, objective markdown, or
// any field whose key matches the REDACT_KEYS set. This matches DEVELOPMENT_PLAN.md
// §Logs ("never message content at default info level; no tokens or objective secrets").

const REDACT_KEYS = new Set([
  'token', 'authorization', 'bearer', 'password', 'secret', 'api_key',
  'apikey', 'access_key', 'private_key', 'credential', 'text', 'markdown',
  'content', 'payload',
]);

function sanitize(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger({ stream = process.stderr, level = 'info' } = {}) {
  const minRank = LEVEL_RANK[level] ?? 1;

  function write(lvl, event, ctx) {
    if ((LEVEL_RANK[lvl] ?? 0) < minRank) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      event,
      ...sanitize(ctx),
    });
    stream.write(line + '\n');
  }

  return {
    debug: (event, ctx) => write('debug', event, ctx),
    info:  (event, ctx) => write('info',  event, ctx),
    warn:  (event, ctx) => write('warn',  event, ctx),
    error: (event, ctx) => write('error', event, ctx),
  };
}

// Module-level default (overridden in tests by passing a custom logger to startServer).
export const logger = createLogger();
