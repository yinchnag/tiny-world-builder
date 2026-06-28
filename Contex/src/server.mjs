// -------- HTTP / HTTPS server --------
// Thin wrapper: binds the MCP Streamable HTTP transport (src/mcp-transport.mjs)
// to a loopback HTTP(S) server. One session store per server instance.
//
// Phase 11 additions:
//   tls              — optional { cert, key } (PEM strings) → HTTPS
//   retentionIntervalMs — periodic purge of expired messages/claims/commands
//                         (0 = disabled; default 0 for backwards-compat)
//   maxRequestsPerMinute — rate-limit per IP (0 = disabled; default 60)
//   logger           — structured JSON logger (default: silent)

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { buildRequestListener, createSessionStore } from './mcp-transport.mjs';
import { createTokenStore } from './auth.mjs';
import { purgeExpiredMessages } from './domain/messaging.mjs';
import { purgeExpiredClaims } from './domain/claims.mjs';
import { expireStaleCommands } from './domain/commands.mjs';
import { createLogger } from './logger.mjs';

export { buildRequestListener, createSessionStore };

// Run all three retention jobs. Errors are caught so a failing job never
// crashes the server — a warning is logged instead.
export function runRetention(contex, log) {
  try { purgeExpiredMessages(contex.db); } catch (e) { log?.warn('retention.messages.error', { error: e.message }); }
  try { purgeExpiredClaims(contex.db); } catch (e) { log?.warn('retention.claims.error', { error: e.message }); }
  try { expireStaleCommands(contex.db); } catch (e) { log?.warn('retention.commands.error', { error: e.message }); }
  log?.debug('retention.ran', {});
}

// Start an HTTP (or HTTPS) server. host defaults to loopback (local-first).
// port 0 picks a free port. Resolves once listening with the bound url/port.
export function startServer({
  contex,
  token,
  port = 0,
  host = '127.0.0.1',
  version = '0.1.0',
  tls = null,                   // { cert: string, key: string } (PEM) → HTTPS
  retentionIntervalMs = 0,      // 0 = disabled
  maxRequestsPerMinute = 60,
  logger: log = createLogger({ stream: { write() {} } }), // silent by default
} = {}) {
  const tokenStore = createTokenStore(token);
  contex.setTokenStore?.(tokenStore); // wire token store into the facade for MCP tool access
  const sessions = createSessionStore();
  const listener = buildRequestListener({ contex, token, tokenStore, version, sessions, maxRequestsPerMinute, logger: log });

  const server = tls
    ? createHttpsServer({ cert: tls.cert, key: tls.key }, listener)
    : createHttpServer(listener);

  // Retention scheduler: purge expired entities on a fixed interval.
  let retentionTimer = null;
  if (retentionIntervalMs > 0) {
    retentionTimer = setInterval(() => runRetention(contex, log), retentionIntervalMs);
    if (typeof retentionTimer.unref === 'function') retentionTimer.unref();
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const scheme = tls ? 'https' : 'http';
      const url = `${scheme}://${host}:${addr.port}/mcp`;
      log.info('server.start', { url, port: addr.port, host, tls: !!tls, retentionIntervalMs, maxRequestsPerMinute });
      resolve({
        server,
        sessions,
        host,
        port: addr.port,
        url,
        token,
        tokenStore,
        close: () => {
          if (retentionTimer) clearInterval(retentionTimer);
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}
