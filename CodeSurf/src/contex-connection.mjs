// Contex connection orchestrator.
//
// Ties the process supervisor to the MCP client and exposes the operations
// CodeSurf needs: mirror canvas links into Contex, subscribe to peer/state
// notifications, and drain the canvas command bus. A supervisor restart (which
// rotates the token) transparently rebuilds the client against the new
// url+token, so the canvas and Contex stay consistent across a Contex crash.

import { EventEmitter } from 'node:events';
import { McpClient, McpAuthError } from './mcp-client.mjs';

export class ContexConnection extends EventEmitter {
  /** @param {{supervisor?:object, drainIntervalMs?:number}} opts */
  constructor({ supervisor = null, drainIntervalMs = 1000 } = {}) {
    super();
    this.supervisor = supervisor;
    this.drainIntervalMs = drainIntervalMs;
    this.client = null;
    this.workspaceId = null;
    this.url = null; // exposed to the UI; the token is NEVER exposed
    this.status = 'disconnected';
  }

  _setStatus(s) { if (s !== this.status) { this.status = s; this.emit('status', s); } }

  // -- lifecycle ----------------------------------------------------------

  /** Boot the supervised Contex process, then connect the client to it. */
  async start() {
    if (!this.supervisor) throw new Error('no supervisor configured; use connectDirect()');
    this._setStatus('connecting');
    this.supervisor.on('restart', (hs) => { this._setStatus('offline'); this._connect(hs).catch((e) => this.emit('error', e)); });
    this.supervisor.on('exit', () => { if (this.status === 'connected') this._setStatus('offline'); });
    const hs = await this.supervisor.start();
    await this._connect(hs);
    return { url: this.url, workspaceId: this.workspaceId };
  }

  /** Connect to an already-running Contex (tests / external server). */
  async connectDirect({ url, token, workspace_id }) {
    this._setStatus('connecting');
    await this._connect({ url, token, workspace_id });
    return { url: this.url, workspaceId: this.workspaceId };
  }

  async _connect({ url, token, workspace_id }) {
    if (this.client) { try { await this.client.close(); } catch { /* ignore */ } }
    this.url = url;
    if (workspace_id) this.workspaceId = workspace_id;
    const client = new McpClient({ url, token });
    client.on('notification', (n) => this._onNotification(n));
    client.on('closed', () => { if (this.status === 'connected') this._setStatus('offline'); });
    this.client = client;
    await client.connect();
    this._setStatus('connected');
    this._startDrain();
  }

  // -- notifications ------------------------------------------------------

  _onNotification(n) {
    // forward everything; also surface a couple of high-value channels by name
    this.emit('event', n);
    const method = n?.method || '';
    if (method.endsWith('tile_state_changed')) this.emit('tile_state', n.params);
    else if (method.endsWith('human_attention')) this.emit('attention', n.params);
    else if (method.endsWith('peer_link_changed')) this.emit('link_changed', n.params);
    else if (method.endsWith('canvas_command')) this._drainOnce().catch(() => {}); // wake the drain early
  }

  // -- link mirroring -----------------------------------------------------

  async linkTiles(source, target, { directed = false, kind } = {}) {
    return this._call('link_tiles', {
      source_tile_id: source, target_tile_id: target, directed,
      ...(kind ? { kind } : {}), workspace_id: this.workspaceId,
    });
  }

  async unlinkTiles(source, target) {
    return this._call('unlink_tiles', {
      source_tile_id: source, target_tile_id: target, workspace_id: this.workspaceId,
    });
  }

  // -- canvas command bus -------------------------------------------------

  _startDrain() {
    clearInterval(this._drainTimer);
    this._drainTimer = setInterval(() => this._drainOnce().catch(() => {}), this.drainIntervalMs);
    this._drainOnce().catch(() => {});
  }

  async _drainOnce() {
    if (!this.client?.connected) return;
    const res = await this.client.call('canvas_next_commands', { workspace_id: this.workspaceId, limit: 20 });
    const commands = Array.isArray(res?.commands) ? res.commands : Array.isArray(res) ? res : [];
    for (const cmd of commands) this.emit('command', cmd);
    return commands;
  }

  /** Report a canvas command's outcome back to Contex (idempotent server-side). */
  async completeCommand(commandId, result, error) {
    return this._call('canvas_complete_command', {
      command_id: commandId, ...(result ? { result } : {}), ...(error ? { error } : {}),
    });
  }

  // -- generic passthrough ------------------------------------------------

  async call(name, args) { return this._call(name, args); }

  /** Env an in-tile agent process needs to self-register with Contex. SERVER-SIDE
   *  ONLY — carries the bearer token, so it must never be sent to the browser. */
  agentEnv() {
    if (!this.client) return {};
    return {
      CONTEX_URL: this.url,
      CONTEX_TOKEN: this.client.token,
      CONTEX_WORKSPACE: this.workspaceId || '',
    };
  }

  async _call(name, args) {
    if (!this.client) throw new Error('not connected to Contex');
    try {
      return await this.client.call(name, args);
    } catch (err) {
      if (err instanceof McpAuthError) this._setStatus('offline'); // token rotated; supervisor restart will reconnect
      throw err;
    }
  }

  async stop() {
    clearInterval(this._drainTimer);
    if (this.client) { try { await this.client.close(); } catch { /* ignore */ } }
    if (this.supervisor) await this.supervisor.stop();
    this._setStatus('disconnected');
  }
}
