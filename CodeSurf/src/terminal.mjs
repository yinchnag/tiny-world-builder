// Terminal tile backend — runs a real child process per tile (M5, increment 1).
//
// Zero-dependency: uses node:child_process with piped stdio (NOT a true PTY).
// That means no TTY semantics (isatty=false, no raw-mode line editing); a real
// pseudo-terminal (node-pty / ConPTY) is a documented follow-up for fully
// interactive agent CLIs. What works today: spawn a command with injected env
// (CARD_ID = tile id, plus the Contex url/token so the agent self-registers via
// the .claude/CLAUDE.md protocol), stream stdout/stderr to the tile, feed stdin,
// stop/restart, and keep a bounded scrollback.
//
// The Contex bearer token is injected into the CHILD's env (server-side); it is
// never written to the scrollback or sent to the browser.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_BUFFER = 200_000; // chars of scrollback retained per tile

/**
 * Write/merge a project `.mcp.json` so a real `claude`/`codex` CLI launched in
 * the tile auto-discovers Contex. Uses `${CONTEX_URL}`/`${CONTEX_TOKEN}` env
 * expansion — the literal token is NEVER written to disk (CodeSurf injects those
 * vars into the child env). Existing entries are preserved; only `contex` is set.
 */
export function ensureMcpConfig(cwd) {
  const file = join(cwd, '.mcp.json');
  let cfg = { mcpServers: {} };
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { cfg = { mcpServers: {} }; }
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  cfg.mcpServers.contex = {
    type: 'http',
    url: '${CONTEX_URL}',
    headers: { Authorization: 'Bearer ${CONTEX_TOKEN}' },
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

/** One supervised child process bound to a tile. */
export class Terminal extends EventEmitter {
  constructor(tileId, { maxBuffer = DEFAULT_MAX_BUFFER } = {}) {
    super();
    this.tileId = tileId;
    this.maxBuffer = maxBuffer;
    this.buffer = '';
    this.child = null;
    this.status = 'idle'; // idle | running | exited
    this.exitCode = null;
    this.lastCommand = null;
  }

  start({ command, args = [], cwd, env = {}, contexEnv = {} } = {}) {
    if (this.child) throw new Error('terminal already running');
    if (!command || typeof command !== 'string') throw new Error('command required');
    const childEnv = { ...process.env, ...env, ...contexEnv, CARD_ID: this.tileId };
    const child = spawn(command, args, { cwd: cwd || process.cwd(), env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.status = 'running';
    this.exitCode = null;
    this.lastCommand = { command, args, cwd: cwd || process.cwd() };
    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.on('data', (d) => this._onData(d));
    child.on('exit', (code, signal) => {
      this.status = 'exited';
      this.exitCode = code;
      this.child = null;
      this.emit('exit', { code, signal });
    });
    child.on('error', (err) => {
      this._append(`\n[spawn error: ${err.message}]\n`);
      this.status = 'exited';
      this.child = null;
      this.emit('exit', { code: null, signal: null, error: err.message });
    });
    this.emit('started', this.lastCommand);
    return this.lastCommand;
  }

  _onData(d) { this._append(d.toString('utf8')); }
  _append(s) {
    this.buffer = (this.buffer + s).slice(-this.maxBuffer);
    this.emit('data', s);
  }

  /** Surface a CodeSurf-side notice in the tile's output (not from the child). */
  note(msg) { this._append(`[CodeSurf] ${msg}\n`); }

  write(data) {
    if (!this.child) throw new Error('terminal not running');
    this.child.stdin.write(data);
  }

  /** Send a control action (currently: interrupt = Ctrl-C, eof = close stdin). */
  control(action) {
    if (!this.child) throw new Error('terminal not running');
    if (action === 'interrupt') this.child.kill('SIGINT');
    else if (action === 'eof') this.child.stdin.end();
    else throw new Error(`unknown control: ${action}`);
  }

  stop() { if (this.child) this.child.kill(); }

  async restart(spec) {
    const next = spec || this.lastCommand;
    if (this.child) {
      await new Promise((resolve) => { this.once('exit', resolve); this.child.kill(); });
    }
    this.buffer = '';
    return this.start(next);
  }

  snapshot() {
    return { tileId: this.tileId, status: this.status, exitCode: this.exitCode, command: this.lastCommand };
  }
}

/** Owns the terminals for a workspace; injects Contex env on start. */
export class TerminalManager extends EventEmitter {
  constructor({ contex = null } = {}) {
    super();
    this.contex = contex;
    this.terminals = new Map();
  }

  ensure(tileId) {
    if (!this.terminals.has(tileId)) {
      const t = new Terminal(tileId);
      t.on('data', (data) => this.emit('data', { tileId, data }));
      t.on('exit', (e) => this.emit('exit', { tileId, ...e }));
      t.on('started', (c) => this.emit('started', { tileId, ...c }));
      this.terminals.set(tileId, t);
    }
    return this.terminals.get(tileId);
  }

  start(tileId, spec = {}) {
    const t = this.ensure(tileId);
    const contexEnv = this.contex?.agentEnv?.() || {};
    // (a) drop a secret-free .mcp.json so a real claude/codex CLI finds Contex
    if (contexEnv.CONTEX_URL && spec.cwd) {
      try { t.note(`wrote ${ensureMcpConfig(spec.cwd)} (contex MCP server; env-ref, no token on disk)`); }
      catch (e) { t.note(`could not write .mcp.json: ${e.message}`); }
    }
    return t.start({ ...spec, contexEnv });
  }

  write(tileId, data) { this.terminals.get(tileId)?.write(data); }
  control(tileId, action) { this.terminals.get(tileId)?.control(action); }
  stop(tileId) { this.terminals.get(tileId)?.stop(); }
  scrollback(tileId) { return this.terminals.get(tileId)?.buffer || ''; }
  status(tileId) {
    const t = this.terminals.get(tileId);
    return t ? t.snapshot() : { tileId, status: 'idle', exitCode: null, command: null };
  }
  stopAll() { for (const t of this.terminals.values()) t.stop(); }
}
