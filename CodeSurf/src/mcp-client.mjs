// Hand-rolled MCP Streamable-HTTP client (zero dependency).
//
// Speaks the same transport the Contex server implements: POST /mcp for
// initialize + tools/call (single JSON response), GET /mcp for the server→client
// SSE notification stream. This is the client the real-client smoke proved out,
// now productionized with reconnect, event de-duplication, and session recovery.

import { EventEmitter } from 'node:events';

export class McpAuthError extends Error { constructor(m) { super(m); this.name = 'McpAuthError'; this.code = 'MCP_AUTH'; } }
export class McpCallError extends Error {
  constructor(code, message, details) { super(message); this.name = 'McpCallError'; this.code = code; this.details = details; }
}

function parseBody(text, ct) {
  if (!text) return null;
  if (ct && ct.includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}

export class McpClient extends EventEmitter {
  /** @param {{url:string, token:string, protocolVersion?:string, clientInfo?:object}} opts */
  constructor({ url, token, protocolVersion = '2025-03-26', clientInfo } = {}) {
    super();
    this.url = url;
    this.token = token;
    this.protocolVersion = protocolVersion;
    this.clientInfo = clientInfo || { name: 'codesurf', version: '0.1' };
    this.session = null;
    this.connected = false;
    this._idSeq = 1;
    this._seenEventIds = new Set(); // SSE de-duplication
    this.lastEventId = null;
    this._streamAbort = null;
    this._closed = false;
    this._reconnectDelay = 200;
  }

  // -- low-level POST -----------------------------------------------------
  async _post(message, isNotification = false) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + this.token,
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(message) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    if (res.status === 401) { await res.text().catch(() => {}); throw new McpAuthError('unauthorized (token rotated?)'); }
    const text = await res.text();
    return { status: res.status, body: parseBody(text, res.headers.get('content-type')) };
  }

  _nextId() { return this._idSeq++; }

  // -- handshake ----------------------------------------------------------
  async connect() {
    this._closed = false;
    const r = await this._post({
      jsonrpc: '2.0', id: this._nextId(), method: 'initialize',
      params: { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: this.clientInfo },
    });
    if (r.body?.error) throw new McpCallError(r.body.error.code, r.body.error.message);
    this.serverInfo = r.body?.result?.serverInfo;
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true);
    this.connected = true;
    this.emit('connected', { session: this.session, serverInfo: this.serverInfo });
    this._openStream();
    return this.serverInfo;
  }

  // -- tool calls ---------------------------------------------------------
  async listTools() {
    const r = await this._post({ jsonrpc: '2.0', id: this._nextId(), method: 'tools/list', params: {} });
    return r.body?.result?.tools || [];
  }

  /** Call a tool; returns structuredContent. Throws McpCallError on a business
   *  error, and auto-recovers once from an expired session (404). */
  async call(name, args = {}, { _retried = false } = {}) {
    const r = await this._post({
      jsonrpc: '2.0', id: this._nextId(), method: 'tools/call',
      params: { name, arguments: args },
    });
    if (r.status === 404 && !_retried) {
      // session expired — re-initialize once and retry
      this.session = null; this.connected = false;
      await this.connect();
      return this.call(name, args, { _retried: true });
    }
    if (r.body?.error) throw new McpCallError(r.body.error.code || 'MCP_ERROR', r.body.error.message);
    const result = r.body?.result;
    if (result?.isError) {
      const e = result.structuredContent?.error;
      throw new McpCallError(e?.code || 'CONTEXT_ERROR', e?.message || textOf(result), e?.details);
    }
    return result?.structuredContent ?? parseTextResult(result);
  }

  // -- server→client notification stream ----------------------------------
  async _openStream() {
    if (this._closed) return;
    const ac = new AbortController();
    this._streamAbort = ac;
    let res;
    try {
      const headers = { accept: 'text/event-stream', authorization: 'Bearer ' + this.token };
      if (this.session) headers['mcp-session-id'] = this.session;
      if (this.lastEventId) headers['last-event-id'] = this.lastEventId;
      res = await fetch(this.url, { method: 'GET', headers, signal: ac.signal });
    } catch {
      return this._scheduleReconnect();
    }
    if (!res.ok || !res.body) return this._scheduleReconnect();
    this._reconnectDelay = 200; // healthy stream resets backoff
    this._readStream(res.body).catch(() => {}).finally(() => { if (!this._closed) this._scheduleReconnect(); });
  }

  async _readStream(body) {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        this._handleEventBlock(block);
      }
    }
  }

  _handleEventBlock(block) {
    let id = null, dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (id !== null) {
      if (this._seenEventIds.has(id)) return; // duplicate — drop
      this._seenEventIds.add(id);
      this.lastEventId = id;
    }
    if (dataLines.length === 0) return;
    let payload;
    try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }
    this.emit('notification', payload);
  }

  _scheduleReconnect() {
    if (this._closed) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 5000);
    this._reconnectTimer = setTimeout(() => this._openStream(), delay);
  }

  async close() {
    this._closed = true;
    clearTimeout(this._reconnectTimer);
    this._streamAbort?.abort();
    if (this.session) {
      try {
        await fetch(this.url, { method: 'DELETE', headers: { authorization: 'Bearer ' + this.token, 'mcp-session-id': this.session } });
      } catch { /* server may already be gone */ }
    }
    this.connected = false;
    this.emit('closed');
  }
}

function textOf(result) {
  return result?.content?.find?.((c) => c.type === 'text')?.text || 'tool error';
}
function parseTextResult(result) {
  const t = textOf(result);
  try { return JSON.parse(t); } catch { return { text: t }; }
}
