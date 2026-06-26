// CodeSurf loopback HTTP shell.
//
// Zero-dependency Node http server (node:http only) that serves the single-page
// DOM/SVG canvas from `public/` and a small JSON API over the M1 WorkspaceStore.
// Binds 127.0.0.1 only and rejects non-loopback Host headers (cheap DNS-rebinding
// guard) — the renderer is a local browser, so this is the trust boundary.
//
// API:
//   GET  /                          -> index.html (canvas shell)
//   GET  /canvas.js | /style.css    -> static assets
//   GET  /api/workspaces            -> { workspaces }
//   POST /api/workspaces            { name, repositoryPath } -> meta
//   GET  /api/workspaces/:id        -> { meta, layout, recovered }  (opens + locks)
//   PUT  /api/workspaces/:id/layout { layout } -> { ok, layout }    (autosave)
//   POST /api/workspaces/:id/close  -> { ok }                       (releases lock)

import { createServer as httpCreateServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, normalize } from 'node:path';
import { CodeSurfError } from './errors.mjs';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function contentTypeFor(file) {
  const dot = file.lastIndexOf('.');
  return CONTENT_TYPES[dot >= 0 ? file.slice(dot).toLowerCase() : ''] || 'application/octet-stream';
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
                          'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, err) {
  if (err instanceof CodeSurfError) {
    const status = err.code === 'CODESURF_NOT_FOUND' ? 404
      : err.code === 'CODESURF_WORKSPACE_LOCKED' ? 409
      : err.code === 'CODESURF_REPO_INVALID' || err.code === 'CODESURF_BAD_REQUEST' ? 400 : 500;
    return sendJson(res, status, { error: err.toJSON() });
  }
  return sendJson(res, 500, { error: { code: 'CODESURF_INTERNAL', message: String(err && err.message || err) } });
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new CodeSurfError('CODESURF_BAD_REQUEST', 'request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new CodeSurfError('CODESURF_BAD_REQUEST', 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const path = normalize(join(PUBLIC_DIR, rel));
  // traversal guard — resolved path must stay under public/
  if (path !== PUBLIC_DIR && !path.startsWith(PUBLIC_DIR + (process.platform === 'win32' ? '\\' : '/'))) {
    return sendJson(res, 403, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad path' } });
  }
  try {
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': contentTypeFor(path), 'content-length': buf.length, 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    sendJson(res, 404, { error: { code: 'CODESURF_NOT_FOUND', message: `asset missing: ${rel}` } });
  }
}

/** Build the request handler bound to a WorkspaceStore and an optional
 *  ContexConnection (Contex integration is opt-in — CodeSurf runs canvas-only
 *  without it). */
export function createHandler(store, contex = null) {
  return async function handler(req, res) {
    try {
      if (!isLoopbackHost(req.headers.host)) {
        return sendJson(res, 403, { error: { code: 'CODESURF_FORBIDDEN', message: 'non-loopback host rejected' } });
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method;

      // ---- Contex integration (opt-in) ----
      if (path === '/api/contex/status' && method === 'GET') {
        return sendJson(res, 200, contex
          ? { status: contex.status, url: contex.url, workspaceId: contex.workspaceId } // token NEVER exposed
          : { status: 'disconnected' });
      }
      if (path === '/api/contex/links' && (method === 'POST' || method === 'DELETE')) {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        if (!body.source || !body.target) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'source and target required');
        const out = method === 'POST'
          ? await contex.linkTiles(body.source, body.target, { directed: !!body.directed })
          : await contex.unlinkTiles(body.source, body.target);
        return sendJson(res, 200, { ok: true, result: out });
      }
      if (path === '/api/contex/events' && method === 'GET') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        return streamContexEvents(req, res, contex);
      }

      // ---- API ----
      if (path === '/api/workspaces' && method === 'GET') {
        return sendJson(res, 200, { workspaces: store.listWorkspaces({ includeArchived: url.searchParams.get('all') === '1' }) });
      }
      if (path === '/api/workspaces' && method === 'POST') {
        const body = (await readBody(req)) || {};
        const meta = store.createWorkspace({ name: body.name, repositoryPath: body.repositoryPath });
        return sendJson(res, 201, meta);
      }

      const wsMatch = path.match(/^\/api\/workspaces\/([^/]+)$/);
      if (wsMatch && method === 'GET') {
        return sendJson(res, 200, store.openWorkspace(decodeURIComponent(wsMatch[1])));
      }

      const layoutMatch = path.match(/^\/api\/workspaces\/([^/]+)\/layout$/);
      if (layoutMatch && method === 'PUT') {
        const id = decodeURIComponent(layoutMatch[1]);
        const body = (await readBody(req)) || {};
        const layout = store.saveLayout(id, body.layout ?? body);
        return sendJson(res, 200, { ok: true, layout });
      }

      const closeMatch = path.match(/^\/api\/workspaces\/([^/]+)\/close$/);
      if (closeMatch && method === 'POST') {
        store.closeWorkspace(decodeURIComponent(closeMatch[1]));
        return sendJson(res, 200, { ok: true });
      }

      // ---- static assets (any GET that isn't an API route) ----
      if (method === 'GET' && !path.startsWith('/api/')) return serveStatic(res, path);

      sendJson(res, 404, { error: { code: 'CODESURF_NOT_FOUND', message: `no route: ${method} ${path}` } });
    } catch (err) {
      sendError(res, err);
    }
  };
}

/** Forward Contex notifications/status to the browser over SSE. */
function streamContexEvents(req, res, contex) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`event: status\ndata: ${JSON.stringify({ status: contex.status })}\n\n`);
  const onEvent = (n) => res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
  const onStatus = (s) => res.write(`event: status\ndata: ${JSON.stringify({ status: s })}\n\n`);
  const onTile = (p) => res.write(`event: tile_state\ndata: ${JSON.stringify(p)}\n\n`);
  contex.on('event', onEvent);
  contex.on('status', onStatus);
  contex.on('tile_state', onTile);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepalive);
    contex.off('event', onEvent);
    contex.off('status', onStatus);
    contex.off('tile_state', onTile);
  });
}

/** Create (but do not listen on) an http.Server bound to a store + optional Contex. */
export function createServer(store, contex = null) {
  return httpCreateServer(createHandler(store, contex));
}

/** Start the loopback server. Resolves with { server, url, port }. */
export function startServer({ store, contex = null, host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(store, contex);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: `http://${host}:${addr.port}/` });
    });
  });
}
