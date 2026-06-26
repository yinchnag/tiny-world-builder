// Contex process supervisor.
//
// Launches `contex serve` as a child process, parses the listening handshake it
// prints on stderr ({ event:'listening', url, token, workspace_id }), and keeps
// it alive — a crash triggers a backed-off restart that re-emits a fresh
// url+token (Contex mints a new in-memory token each boot, so a restart IS a
// token rotation). The token is held in memory and never logged.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONTEX_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Contex', 'src', 'cli.mjs');

export class ContexSupervisor extends EventEmitter {
  /**
   * @param {{command?:string, args?:string[], cwd?:string, env?:object,
   *          restart?:boolean, maxRestarts?:number, backoffMs?:number}} opts
   */
  constructor(opts = {}) {
    super();
    // Contex needs Node >= 22.5 (built-in node:sqlite). Under Electron,
    // process.execPath is electron.exe (older bundled Node, no node:sqlite), so
    // spawn the real system node instead — npm records it in npm_node_execpath.
    const defaultNode = process.versions.electron
      ? (process.env.npm_node_execpath || 'node')
      : process.execPath;
    this.command = opts.command || defaultNode;
    this.args = opts.args || ['--experimental-sqlite', CONTEX_CLI, 'serve'];
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.restart = opts.restart !== false;
    this.maxRestarts = opts.maxRestarts ?? Infinity;
    this.backoffMs = opts.backoffMs ?? 300;
    this.child = null;
    this.handshake = null; // { url, token, workspace_id }
    this._stopped = false;
    this._restarts = 0;
    this._readyOnce = null;
  }

  /** Start (or first-start) the process; resolves with the handshake. */
  start() {
    this._stopped = false;
    return new Promise((resolve, reject) => {
      this._readyOnce = { resolve, reject };
      this._spawn();
    });
  }

  _spawn() {
    let child;
    try {
      child = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      if (this._readyOnce) { this._readyOnce.reject(err); this._readyOnce = null; }
      return;
    }
    this.child = child;
    let readyThisLife = false;

    const rl = createInterface({ input: child.stderr });
    rl.on('line', (line) => {
      this.emit('log', line);
      const hs = tryHandshake(line);
      if (hs && !readyThisLife) {
        readyThisLife = true;
        const first = this.handshake === null;
        this.handshake = hs;
        if (this._readyOnce) { this._readyOnce.resolve(hs); this._readyOnce = null; }
        this.emit(first ? 'ready' : 'restart', hs);
      }
    });

    child.on('error', (err) => {
      this.emit('error', err);
      if (this._readyOnce) { this._readyOnce.reject(err); this._readyOnce = null; }
    });

    child.on('exit', (code, signal) => {
      rl.close();
      this.child = null;
      this.emit('exit', { code, signal });
      if (this._stopped || !this.restart) return;
      if (this._restarts >= this.maxRestarts) { this.emit('giveup'); return; }
      this._restarts++;
      const delay = Math.min(this.backoffMs * this._restarts, 5000);
      this._restartTimer = setTimeout(() => { if (!this._stopped) this._spawn(); }, delay);
    });
  }

  /** Stop the process and disable restart. */
  async stop() {
    this._stopped = true;
    clearTimeout(this._restartTimer);
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
      // hard-kill backstop for a process that ignores SIGTERM
      this._killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    });
    clearTimeout(this._killTimer);
    this.child = null;
  }
}

function tryHandshake(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  let obj;
  try { obj = JSON.parse(t); } catch { return null; }
  if (obj.event === 'listening' && obj.url && obj.token) {
    return { url: obj.url, token: obj.token, workspace_id: obj.workspace_id, port: obj.port };
  }
  return null;
}
