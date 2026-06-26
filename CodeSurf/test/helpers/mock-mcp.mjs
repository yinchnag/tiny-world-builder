// Minimal mock MCP Streamable-HTTP server for client tests. Speaks just enough
// of the protocol: bearer auth, initialize→session, initialized→202, tools/list,
// tools/call (pluggable handlers), a GET SSE stream with push()+id de-dup, and
// DELETE session teardown.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function startMockMcp({ token = 'tok-a', tools = {}, toolList = [] } = {}) {
  let currentToken = token;
  const sessions = new Set();
  const streams = new Set(); // active SSE responses
  let eventSeq = 1;
  const callLog = [];

  function authed(req) {
    return req.headers.authorization === 'Bearer ' + currentToken;
  }

  async function readJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
  }

  const server = createServer(async (req, res) => {
    if (!authed(req)) { res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'CONTEXT_AUTH_REQUIRED' } })); }

    if (req.method === 'GET') { // SSE stream
      const sid = req.headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': open\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'];
      sessions.delete(sid);
      res.writeHead(200); return res.end();
    }

    if (req.method === 'POST') {
      const msg = await readJson(req);
      const sid = req.headers['mcp-session-id'];
      // reject unknown session (except initialize, which mints one)
      if (msg.method !== 'initialize' && msg.id !== undefined && sid && !sessions.has(sid)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'session expired' } }));
      }
      if (msg.method === 'initialize') {
        const newSid = randomUUID();
        sessions.add(newSid);
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': newSid });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'mock-contex', version: '0.0' } } }));
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (msg.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: toolList } }));
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        callLog.push({ name, args });
        const handler = tools[name];
        let result;
        try {
          const out = handler ? await handler(args) : { echo: args };
          result = { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
        } catch (err) {
          result = { content: [{ type: 'text', text: String(err.message) }], isError: true,
                     structuredContent: { error: { code: err.code || 'CONTEXT_ERROR', message: err.message } } };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      }
      res.writeHead(202); return res.end();
    }
    res.writeHead(405); res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      resolve({
        url,
        server,
        callLog,
        setToken(t) { currentToken = t; },
        /** push a notification to all open streams. Same id twice = de-dup test. */
        push(payload, id) {
          const eid = id ?? eventSeq++;
          const frame = `id: ${eid}\ndata: ${JSON.stringify(payload)}\n\n`;
          for (const s of streams) s.write(frame);
        },
        dropStreams() { for (const s of streams) s.end(); streams.clear(); },
        close() { for (const s of streams) try { s.end(); } catch {} ; return new Promise((r) => server.close(r)); },
      });
    });
  });
}
