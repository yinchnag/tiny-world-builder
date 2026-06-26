// -------- test helpers --------
// Two clients:
//   MockAgent  — minimal sessionless caller used by the domain/E2E tests.
//   McpClient  — spec-compliant Streamable HTTP client (initialize handshake,
//                Mcp-Session-Id, Accept negotiation, GET notification stream,
//                DELETE) used by the transport tests. Stands in for a real
//                Claude/Codex MCP client.

let nextId = 1;

export class MockAgent {
  constructor(url, token, tileId) {
    this.url = url;
    this.token = token;
    this.tileId = tileId;
  }

  async rpc(method, params, { token = this.token } = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    return { status: res.status, body: await res.json() };
  }

  async tool(name, args = {}) {
    const { status, body } = await this.rpc('tools/call', { name, arguments: args });
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    const result = body.result;
    return { data: result.structuredContent, isError: !!result.isError };
  }

  setState(args) { return this.tool('peer_set_state', { tile_id: this.tileId, ...args }); }
  getState(args = {}) { return this.tool('peer_get_state', { tile_id: this.tileId, ...args }); }
  readMessages(args = {}) { return this.tool('peer_read_messages', { tile_id: this.tileId, ...args }); }
}

export class McpClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.sessionId = null;
  }

  async post(method, params = {}, { sessionId = this.sessionId } = {}) {
    const isNotification = method.startsWith('notifications/');
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`,
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const body = { jsonrpc: '2.0', method, params };
    if (!isNotification) body.id = nextId++;
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    return { status: res.status, sessionId: sid, body: text ? JSON.parse(text) : null };
  }

  // full handshake: initialize -> capture session -> initialized notification
  async initialize() {
    const r = await this.post('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    await this.post('notifications/initialized', {});
    return r;
  }

  async callTool(name, args = {}) {
    const r = await this.post('tools/call', { name, arguments: args });
    return r.body.result;
  }

  listResources() { return this.post('resources/list', {}); }
  readResource(uri) { return this.post('resources/read', { uri }); }

  // open the server->client SSE stream; returns the raw Response for reading
  openStream() {
    return fetch(this.url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream', 'mcp-session-id': this.sessionId },
    });
  }

  deleteSession() {
    return fetch(this.url, { method: 'DELETE', headers: { authorization: `Bearer ${this.token}`, 'mcp-session-id': this.sessionId } });
  }
}

// Read an SSE Response until a notification matching `predicate` arrives, or
// timeout (returns null). Parses `data:` frames as JSON-RPC messages.
export async function waitForNotification(res, predicate, timeoutMs = 2000) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const timer = setTimeout(() => { reader.cancel().catch(() => {}); }, timeoutMs);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const msg = JSON.parse(dataLine.slice(5).trim());
        if (predicate(msg)) { await reader.cancel().catch(() => {}); return msg; }
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
