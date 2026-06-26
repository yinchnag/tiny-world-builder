// -------- HTTP server --------
// Thin wrapper: binds the MCP Streamable HTTP transport (src/mcp-transport.mjs)
// to a loopback HTTP server. One session store per server instance.

import { createServer as createHttpServer } from 'node:http';
import { buildRequestListener, createSessionStore } from './mcp-transport.mjs';

export { buildRequestListener, createSessionStore };

// Start an HTTP server. host defaults to loopback (local-first). port 0 picks a
// free port. Resolves once listening with the bound url/port.
export function startServer({ contex, token, port = 0, host = '127.0.0.1', version = '0.1.0' } = {}) {
  const sessions = createSessionStore();
  const server = createHttpServer(buildRequestListener({ contex, token, version, sessions }));
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        sessions,
        host,
        port: addr.port,
        url: `http://${host}:${addr.port}/mcp`,
        token,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
