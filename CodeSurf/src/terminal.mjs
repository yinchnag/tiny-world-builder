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
import { createRequire } from 'node:module';

const DEFAULT_MAX_BUFFER = 200_000; // chars of scrollback retained per tile
const require = createRequire(import.meta.url);

// node-pty is OPTIONAL (a native dependency, Electron-mode only). The core stays
// zero-dep: if it isn't installed, terminals fall back to piped stdio. Loaded
// lazily so `node --test` never needs it.
let _ptyMod;
let _ptyTried = false;
export function loadPty() {
  if (_ptyTried) return _ptyMod;
  _ptyTried = true;
  try { _ptyMod = require('node-pty'); } catch { _ptyMod = null; }
  return _ptyMod;
}
/** True when a real PTY backend is available in this runtime. */
export function ptyAvailable() { return !!loadPty(); }

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

/** One supervised child process bound to a tile. Uses a real PTY when enabled
 *  and node-pty is available, otherwise piped stdio. */
export class Terminal extends EventEmitter {
  constructor(tileId, { maxBuffer = DEFAULT_MAX_BUFFER, pty = false, cols = 80, rows = 24 } = {}) {
    super();
    this.tileId = tileId;
    this.maxBuffer = maxBuffer;
    this.usePty = !!pty;
    this.cols = cols;
    this.rows = rows;
    this.buffer = '';
    this.child = null;   // child_process (pipe backend)
    this.pty = null;     // IPty (pty backend)
    this.backend = null; // 'pty' | 'pipe'
    this.status = 'idle'; // idle | running | exited
    this.exitCode = null;
    this.lastCommand = null;
  }

  get running() { return !!(this.child || this.pty); }

  start({ command, args = [], cwd, env = {}, contexEnv = {} } = {}) {
    if (this.running) throw new Error('terminal already running');
    if (!command || typeof command !== 'string') throw new Error('command required');
    const childEnv = { ...process.env, ...env, ...contexEnv, CARD_ID: this.tileId };
    const workdir = cwd || process.cwd();
    this.lastCommand = { command, args, cwd: workdir };
    if (this.usePty) {
      const mod = loadPty();
      if (mod) return this._startPty(mod, { command, args, workdir, childEnv });
      this.note('node-pty unavailable — using piped stdio (no TTY)');
    }
    return this._startPipe({ command, args, workdir, childEnv });
  }

  _startPty(mod, { command, args, workdir, childEnv }) {
    let p;
    try {
      p = mod.spawn(command, args, { name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd: workdir, env: childEnv });
    } catch (err) {
      this._append(`\n[spawn error: ${err.message}]\n`);
      this.status = 'exited';
      this.emit('exit', { code: null, signal: null, error: err.message });
      return this.lastCommand;
    }
    this.pty = p;
    this.backend = 'pty';
    this.status = 'running';
    this.exitCode = null;
    p.onData((d) => this._append(d));
    p.onExit(({ exitCode, signal }) => {
      this.status = 'exited';
      this.exitCode = exitCode;
      this.pty = null;
      this.emit('exit', { code: exitCode, signal });
    });
    this.emit('started', this.lastCommand);
    return this.lastCommand;
  }

  _startPipe({ command, args, workdir, childEnv }) {
    const child = spawn(command, args, { cwd: workdir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.backend = 'pipe';
    this.status = 'running';
    this.exitCode = null;
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
    if (!this.running) throw new Error('terminal not running');
    if (this.pty) this.pty.write(data);
    else this.child.stdin.write(data);
  }

  /** Send a control action (interrupt = Ctrl-C, eof). PTY sends the control byte
   *  into the line discipline; piped stdio signals/closes the child. */
  control(action) {
    if (!this.running) throw new Error('terminal not running');
    if (this.pty) {
      if (action === 'interrupt') this.pty.write('\x03');
      else if (action === 'eof') this.pty.write('\x04');
      else throw new Error(`unknown control: ${action}`);
      return;
    }
    if (action === 'interrupt') this.child.kill('SIGINT');
    else if (action === 'eof') this.child.stdin.end();
    else throw new Error(`unknown control: ${action}`);
  }

  /** Resize the PTY viewport (no-op for piped stdio). */
  resize(cols, rows) {
    if (Number.isFinite(cols) && Number.isFinite(rows)) { this.cols = cols; this.rows = rows; }
    if (this.pty) { try { this.pty.resize(this.cols, this.rows); } catch { /* ignore */ } }
  }

  stop() {
    if (this.pty) { try { this.pty.kill(); } catch { /* ignore */ } }
    else if (this.child) this.child.kill();
  }

  async restart(spec) {
    const next = spec || this.lastCommand;
    if (this.running) {
      await new Promise((resolve) => { this.once('exit', resolve); this.stop(); });
    }
    this.buffer = '';
    return this.start(next);
  }

  snapshot() {
    return { tileId: this.tileId, status: this.status, exitCode: this.exitCode, command: this.lastCommand, backend: this.backend };
  }
}

/** Owns the terminals for a workspace; injects Contex env on start. Pass
 *  `pty: true` (Electron/serve when node-pty is present) for real PTYs. */
export class TerminalManager extends EventEmitter {
  constructor({ contex = null, pty = false } = {}) {
    super();
    this.contex = contex;
    this.pty = !!pty;
    this.terminals = new Map();
  }

  ensure(tileId) {
    if (!this.terminals.has(tileId)) {
      const t = new Terminal(tileId, { pty: this.pty });
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
  resize(tileId, cols, rows) { this.terminals.get(tileId)?.resize(cols, rows); }
  stop(tileId) { this.terminals.get(tileId)?.stop(); }
  scrollback(tileId) { return this.terminals.get(tileId)?.buffer || ''; }
  status(tileId) {
    const t = this.terminals.get(tileId);
    return t ? t.snapshot() : { tileId, status: 'idle', exitCode: null, command: null };
  }
  stopAll() { for (const t of this.terminals.values()) t.stop(); }
}
