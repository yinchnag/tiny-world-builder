// -------- MCP Streamable HTTP transport --------
// Implements enough of the MCP Streamable HTTP transport (rev 2025-03-26) for a
// real Claude/Codex client to attach, with ZERO dependencies:
//
//   POST /mcp    one JSON-RPC message (or batch). Requests get an
//                application/json response; pure notifications/responses get 202.
//                `initialize` mints a session and returns it in Mcp-Session-Id.
//   GET  /mcp    opens a text/event-stream the server pushes notifications onto
//                (server->client channel). Requires a valid session. Honors
//                Last-Event-ID for replay of up to MAX_EVENT_RING missed events.
//   DELETE /mcp  terminates a session.
//   GET /health  unauthenticated launcher probe.
//   GET /version unauthenticated — includes schema_version + supported_protocols.
//   GET /events  bearer-only SSE for UI/canvas owners (no MCP session required).
//                Shares the same ring buffer as GET /mcp for replay.
//
// Business failures (ContexError) are MCP tool-call results with isError:true;
// protocol faults (bad JSON, unknown method, bad/expired session, missing auth)
// use HTTP + JSON-RPC errors.
//
// POST responses are always single JSON bodies (the spec permits this). SSE
// stream resumability/replay via Last-Event-ID is implemented here.

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseBearer, tokenMatches, createTokenStore } from './auth.mjs';
import { callTool, toolCatalog } from './tools.mjs';
import { listResources, readResource } from './resources.mjs';
import { ContexError, ErrorCodes } from './errors.mjs';
import { schemaVersion } from './db.mjs';
import { getDbMetrics } from './store.mjs';
import { createLogger } from './logger.mjs';

// Newest first; we echo the client's requested version when we support it.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-03-26';
// Per-server in-memory ring of recent notifications for Last-Event-ID replay.
const MAX_EVENT_RING = 200;

function negotiateProtocol(requested) {
  return SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
}

// -------- sessions --------
export function createSessionStore() {
  const sessions = new Map(); // id -> { createdAt }
  return {
    create() {
      const id = randomUUID();
      sessions.set(id, { createdAt: Date.now() });
      return id;
    },
    has: (id) => sessions.has(id),
    delete: (id) => sessions.delete(id),
    get size() { return sessions.size; },
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function rpcError(res, status, id, code, message, headers = {}) {
  sendJson(res, status, { jsonrpc: '2.0', id: id ?? null, error: { code, message } }, headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4 * 1024 * 1024) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function acceptsEventStream(req) {
  return String(req.headers['accept'] || '').includes('text/event-stream');
}

// -------- JSON-RPC dispatch for a single message --------
// Returns a JSON-RPC response object, or null for notifications (no id).
// authEntry is forwarded to callTool so adminOnly tools can be enforced.
function dispatch(contex, version, message, authEntry = null) {
  const { id, method, params = {} } = message || {};
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: negotiateProtocol(params.protocolVersion),
        serverInfo: { name: 'contex', version },
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
      },
    };
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null; // client notification, nothing to answer
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: toolCatalog() } };
  }
  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: listResources(contex) } };
  }
  if (method === 'resources/read') {
    try {
      return { jsonrpc: '2.0', id, result: { contents: [readResource(contex, params.uri)] } };
    } catch (e) {
      if (e instanceof ContexError) {
        return { jsonrpc: '2.0', id, error: { code: -32002, message: `${e.code}: ${e.message}`, data: { code: e.code } } };
      }
      throw e;
    }
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      const data = callTool(contex, name, args, authEntry);
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false },
      };
    } catch (e) {
      if (e instanceof ContexError) {
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: `${e.code}: ${e.message}` }],
            structuredContent: { error: { code: e.code, message: e.message, details: e.details } },
            isError: true,
          },
        };
      }
      throw e;
    }
  }
  if (isNotification) return null; // unknown notification: ignore
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// -------- per-server event ring --------
// Wraps contex.events, stamping each notification with a monotone server-global
// sequence number and buffering the most recent MAX_EVENT_RING entries. Survives
// client disconnects so a reconnecting stream can replay via Last-Event-ID.
function createEventRing(contex) {
  const ring = [];
  let seq = 0;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  contex.events.on('notification', ({ method, params }) => {
    seq += 1;
    const entry = { seq, method, params };
    ring.push(entry);
    if (ring.length > MAX_EVENT_RING) ring.shift();
    emitter.emit('event', entry);
  });
  return { ring, emitter };
}

// -------- SSE event stream (shared by GET /mcp and GET /events) --------
// Replays buffered events newer than Last-Event-ID, then forwards live events.
// Replay only fires when the `Last-Event-ID` header is explicitly present (per
// the SSE spec — an absent header means "start fresh, no replay").
// Disconnects slow consumers when the socket write buffer is full (backpressure).
// workspaceFilter: when set, only forwards events whose params.workspace_id matches.
function openEventStream(stampedEvents, ring, req, res, workspaceFilter = null) {
  const rawLastId = req.headers['last-event-id'];
  const replayFrom = rawLastId != null ? Math.max(0, parseInt(rawLastId, 10) || 0) : null;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  // Replay buffered events missed since Last-Event-ID (only when header present)
  if (replayFrom != null) {
    for (const e of ring) {
      if (e.seq > replayFrom) {
        if (workspaceFilter && e.params?.workspace_id && e.params.workspace_id !== workspaceFilter) continue;
        res.write(`id: ${e.seq}\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: e.method, params: e.params })}\n\n`);
      }
    }
  }

  let active = true;

  const onEvent = ({ seq, method, params }) => {
    if (!active) return;
    if (workspaceFilter && params?.workspace_id && params.workspace_id !== workspaceFilter) return;
    const ok = res.write(`id: ${seq}\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method, params })}\n\n`);
    if (!ok) {
      // write buffer full — slow consumer; disconnect gracefully
      active = false;
      cleanup();
      res.end();
    }
  };
  stampedEvents.on('event', onEvent);

  const heartbeat = setInterval(() => { if (active) res.write(': keep-alive\n\n'); }, 15_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const cleanup = () => {
    if (!active) return;
    active = false;
    clearInterval(heartbeat);
    stampedEvents.removeListener('event', onEvent);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// -------- rate limiting --------
// Sliding 60-second window per remote IP. Each request increments the counter;
// once maxRequestsPerMinute is exceeded the request is answered with 429 and a
// Retry-After: 60 header. A counter of 0 disables limiting.
function createRateLimiter(maxRequestsPerMinute) {
  if (!maxRequestsPerMinute || maxRequestsPerMinute <= 0) return () => false;
  const state = new Map(); // ip -> { count, windowStart }
  return function isLimited(ip) {
    const now = Date.now();
    let entry = state.get(ip);
    if (!entry || now - entry.windowStart >= 60_000) {
      state.set(ip, (entry = { count: 0, windowStart: now }));
    }
    entry.count += 1;
    return entry.count > maxRequestsPerMinute;
  };
}

// -------- request listener --------
export function buildRequestListener({
  contex, token, tokenStore: ts = null, version = '0.1.0',
  sessions = createSessionStore(),
  maxRequestsPerMinute = 60,
  logger: log = createLogger({ stream: { write() {} } }), // silent by default; caller passes real logger
}) {
  // When a full token store is not provided (backward compat), build a minimal
  // wrapper that authenticates just the single master token.
  const tokenStore = ts ?? (() => {
    const simple = createTokenStore(token);
    return simple;
  })();

  // One ring buffer per server instance — survives client disconnects and
  // reconnects; reset on server restart (new token minted anyway).
  const { ring: eventRing, emitter: stampedEvents } = createEventRing(contex);
  const isRateLimited = createRateLimiter(maxRequestsPerMinute);

  return async (req, res) => {
    const ip = req.socket?.remoteAddress ?? 'unknown';

    // Rate-limit check applies to every request except /health + /version
    // (those are unauthenticated probes from launchers — blocking them would
    // prevent reconnect detection).
    const isProbe = req.method === 'GET' && (req.url === '/health' || req.url === '/version');
    if (!isProbe && isRateLimited(ip)) {
      log.warn('rate.limited', { ip, url: req.url });
      res.writeHead(429, { 'retry-after': '60', 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests', retryAfter: 60 }));
      return;
    }

    // unauthenticated launcher probes
    if (isProbe) {
      return sendJson(res, 200, {
        status: 'ok', name: 'contex', version,
        schema_version: schemaVersion(),
        supported_protocols: SUPPORTED_PROTOCOLS,
        protocol: DEFAULT_PROTOCOL, // kept for back-compat
      });
    }

    // GET /metrics: unauthenticated operational counters for Prometheus-style
    // scrapers or the canvas UI (no sensitive data).
    if (req.method === 'GET' && req.url === '/metrics') {
      const db = contex.db;
      const m = getDbMetrics(db, { heartbeatTimeoutMs: contex.options?.heartbeatTimeoutMs });
      return sendJson(res, 200, { ...m, timestamp: new Date().toISOString() });
    }

    // GET /events: bearer-only SSE for the UI / canvas owner — no MCP session
    // needed. Shares the same ring buffer as GET /mcp for Last-Event-ID replay.
    // Optional ?workspace_id= query param filters events to a single workspace.
    if (req.method === 'GET' && (req.url === '/events' || req.url.startsWith('/events?'))) {
      if (!acceptsEventStream(req)) return sendJson(res, 406, { error: 'GET /events requires Accept: text/event-stream' });
      const evAuth = parseBearer(req.headers['authorization']);
      if (!tokenStore.authenticate(evAuth)) return rpcError(res, 401, null, -32000, ErrorCodes.AUTH_REQUIRED);
      const wsFilter = req.url.includes('?') ? new URL(req.url, 'http://x').searchParams.get('workspace_id') : null;
      return openEventStream(stampedEvents, eventRing, req, res, wsFilter);
    }

    if (req.url !== '/mcp') {
      return rpcError(res, 404, null, -32601, 'Not found');
    }

    // bearer auth on every /mcp request; token lives only in memory
    const provided = parseBearer(req.headers['authorization']);
    const authEntry = tokenStore.authenticate(provided);
    if (!authEntry) {
      return rpcError(res, 401, null, -32000, ErrorCodes.AUTH_REQUIRED);
    }

    const sessionId = req.headers['mcp-session-id'];

    // DELETE: terminate a session
    if (req.method === 'DELETE') {
      if (!sessionId || !sessions.has(sessionId)) return rpcError(res, 404, null, -32001, 'Unknown session');
      sessions.delete(sessionId);
      res.writeHead(200).end();
      return;
    }

    // GET: open the server->client notification stream (needs a live session)
    if (req.method === 'GET') {
      if (!acceptsEventStream(req)) return rpcError(res, 406, null, -32002, 'GET /mcp requires Accept: text/event-stream');
      if (!sessionId || !sessions.has(sessionId)) return rpcError(res, 404, null, -32001, 'Unknown or missing session');
      return openEventStream(stampedEvents, eventRing, req, res);
    }

    if (req.method !== 'POST') return rpcError(res, 405, null, -32601, 'Method not allowed');

    // POST: one JSON-RPC message or a batch
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      return rpcError(res, 400, null, -32700, 'Parse error');
    }
    const batch = Array.isArray(parsed);
    const messages = batch ? parsed : [parsed];
    const hasInitialize = messages.some((m) => m && m.method === 'initialize');

    // session handling: initialize mints one; otherwise a provided id must be valid
    const headers = {};
    if (hasInitialize) {
      headers['mcp-session-id'] = sessions.create();
    } else if (sessionId !== undefined && !sessions.has(sessionId)) {
      return rpcError(res, 404, null, -32001, 'Unknown or expired session');
    }

    let responses;
    try {
      responses = messages.map((m) => {
        const r = dispatch(contex, version, m, authEntry);
        if (r && m.method === 'tools/call') {
          const isErr = r.result?.isError;
          log.info('tool.call', { tool: m.params?.name, session: sessionId, isError: isErr });
        }
        return r;
      }).filter((r) => r !== null);
    } catch (e) {
      log.error('dispatch.error', { error: e.message, session: sessionId });
      return rpcError(res, 500, null, -32603, `Internal error: ${e.message}`, headers);
    }

    // pure notifications/responses -> 202 Accepted, no body
    if (responses.length === 0) {
      res.writeHead(202, headers).end();
      return;
    }
    return sendJson(res, 200, batch ? responses : responses[0], headers);
  };
}
