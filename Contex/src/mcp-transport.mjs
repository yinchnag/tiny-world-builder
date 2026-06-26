// -------- MCP Streamable HTTP transport --------
// Implements enough of the MCP Streamable HTTP transport (rev 2025-03-26) for a
// real Claude/Codex client to attach, with ZERO dependencies:
//
//   POST /mcp    one JSON-RPC message (or batch). Requests get an
//                application/json response; pure notifications/responses get 202.
//                `initialize` mints a session and returns it in Mcp-Session-Id.
//   GET  /mcp    opens a text/event-stream the server pushes notifications onto
//                (server->client channel). Requires a valid session.
//   DELETE /mcp  terminates a session.
//   GET /health  unauthenticated launcher probe (handled here too).
//
// Business failures (ContexError) are MCP tool-call results with isError:true;
// protocol faults (bad JSON, unknown method, bad/expired session, missing auth)
// use HTTP + JSON-RPC errors.
//
// Not yet (documented in PROGRESS.md): SSE stream resumability/replay via
// Last-Event-ID, and POST responses streamed as SSE (we always answer POST with
// a single JSON body, which the spec permits).

import { randomUUID } from 'node:crypto';
import { parseBearer, tokenMatches } from './auth.mjs';
import { callTool, toolCatalog } from './tools.mjs';
import { listResources, readResource } from './resources.mjs';
import { ContexError, ErrorCodes } from './errors.mjs';

// Newest first; we echo the client's requested version when we support it.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-03-26';

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
function dispatch(contex, version, message) {
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
      const data = callTool(contex, name, args);
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

// -------- server->client SSE notification stream --------
function openNotificationStream(contex, req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  let eventId = 0;
  const onNotification = ({ method, params }) => {
    eventId += 1;
    res.write(`id: ${eventId}\n`);
    res.write('event: message\n');
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method, params })}\n\n`);
  };
  contex.events.on('notification', onNotification);

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    contex.events.removeListener('notification', onNotification);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// -------- request listener --------
export function buildRequestListener({ contex, token, version = '0.1.0', sessions = createSessionStore() }) {
  return async (req, res) => {
    // unauthenticated launcher probes
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/version')) {
      return sendJson(res, 200, { status: 'ok', name: 'contex', version, protocol: DEFAULT_PROTOCOL });
    }
    if (req.url !== '/mcp') {
      return rpcError(res, 404, null, -32601, 'Not found');
    }

    // bearer auth on every /mcp request; token lives only in memory
    const provided = parseBearer(req.headers['authorization']);
    if (!provided || !tokenMatches(token, provided)) {
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
      return openNotificationStream(contex, req, res);
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
      responses = messages.map((m) => dispatch(contex, version, m)).filter((r) => r !== null);
    } catch (e) {
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
