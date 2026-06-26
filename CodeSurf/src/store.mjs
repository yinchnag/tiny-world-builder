// Workspace store — local-first, crash-safe layout persistence.
//
// CodeSurf owns tile positions, links, and viewport; Contex owns the live
// agent/message/task state. This module is the CodeSurf-owned half: it persists
// each workspace as a folder on disk with atomic writes and backup recovery,
// so a crash mid-save never loses a good layout.
//
// On-disk shape (under <root>/):
//   index.json                     — list of known workspaces (recents)
//   <id>/workspace.json            — metadata (name, repo path, timestamps)
//   <id>/layout.json               — viewport + tiles + links
//   <id>/layout.json.bak           — previous good layout (rotated on save)
//   <id>/workspace.lock            — single-open guard ({ pid, host, at })
//
// Zero runtime dependencies; node built-ins only.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync,
         readdirSync, copyFileSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { workspaceId } from './ids.mjs';
import { CodeSurfError, Codes, badRequest, notFound } from './errors.mjs';

export const LAYOUT_SCHEMA_VERSION = 1;

/** A blank layout for a fresh workspace. */
export function emptyLayout() {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, viewport: { x: 0, y: 0, zoom: 1 }, tiles: [], links: [] };
}

// ---- atomic write helpers ------------------------------------------------

function writeJsonAtomic(path, value) {
  const tmp = path + '.tmp';
  const data = JSON.stringify(value, null, 2);
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, data);
    fsyncSync(fd); // flush to disk before the rename so the swap is durable
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path); // atomic on the same filesystem
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---- secret scrubbing ----------------------------------------------------

const SECRET_KEYS = new Set([
  'env', 'token', 'secret', 'authorization', 'password', 'headers', 'apikey', 'apiKey', 'bearer',
]);

/** Deep-clone `value`, dropping any key that could carry a credential. */
export function scrubSecrets(value) {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out;
  }
  return value;
}

// ---- store ---------------------------------------------------------------

export class WorkspaceStore {
  /** @param {string} root directory holding all workspaces + the index. */
  constructor(root) {
    if (!root || typeof root !== 'string') throw badRequest('store root path required');
    this.root = root;
    mkdirSync(this.root, { recursive: true });
    this.indexPath = join(this.root, 'index.json');
    this._openLocks = new Map(); // id -> lock path we hold this process
  }

  // -- index --------------------------------------------------------------

  _readIndex() {
    if (!existsSync(this.indexPath)) return { workspaces: [] };
    try {
      const idx = readJson(this.indexPath);
      if (!idx || !Array.isArray(idx.workspaces)) return { workspaces: [] };
      return idx;
    } catch {
      return { workspaces: [] }; // a corrupt index is rebuildable from folders; don't crash
    }
  }

  _writeIndex(idx) {
    writeJsonAtomic(this.indexPath, idx);
  }

  _upsertIndexEntry(meta) {
    const idx = this._readIndex();
    const rest = idx.workspaces.filter((w) => w.id !== meta.id);
    // most-recent first
    idx.workspaces = [{ id: meta.id, name: meta.name, repositoryPath: meta.repositoryPath,
                        lastOpenedAt: meta.lastOpenedAt ?? meta.createdAt, archived: !!meta.archived }, ...rest];
    this._writeIndex(idx);
  }

  // -- paths --------------------------------------------------------------

  _dir(id) { return join(this.root, id); }
  _metaPath(id) { return join(this._dir(id), 'workspace.json'); }
  _layoutPath(id) { return join(this._dir(id), 'layout.json'); }
  _lockPath(id) { return join(this._dir(id), 'workspace.lock'); }

  // -- lifecycle ----------------------------------------------------------

  /** Create a new workspace bound to a repository path. */
  createWorkspace({ name, repositoryPath } = {}) {
    if (!name || typeof name !== 'string') throw badRequest('workspace name required');
    if (!repositoryPath || typeof repositoryPath !== 'string') throw badRequest('repositoryPath required');
    if (!existsSync(repositoryPath)) {
      throw new CodeSurfError(Codes.REPO_INVALID, `repository path does not exist: ${repositoryPath}`);
    }
    const id = workspaceId();
    const now = new Date().toISOString();
    const meta = { id, name, repositoryPath, createdAt: now, lastOpenedAt: now, archived: false };
    mkdirSync(this._dir(id), { recursive: true });
    writeJsonAtomic(this._metaPath(id), meta);
    writeJsonAtomic(this._layoutPath(id), emptyLayout());
    this._upsertIndexEntry(meta);
    return meta;
  }

  /** Known workspaces, most-recently-opened first. Pass includeArchived to see archived ones. */
  listWorkspaces({ includeArchived = false } = {}) {
    const idx = this._readIndex();
    return idx.workspaces.filter((w) => includeArchived || !w.archived);
  }

  _readMeta(id) {
    if (!existsSync(this._metaPath(id))) throw notFound(`workspace not found: ${id}`);
    return readJson(this._metaPath(id));
  }

  /**
   * Acquire the single-open lock and load metadata + layout.
   * Throws WORKSPACE_LOCKED if another live process holds it.
   */
  openWorkspace(id) {
    const meta = this._readMeta(id);
    this._acquireLock(id);
    meta.lastOpenedAt = new Date().toISOString();
    writeJsonAtomic(this._metaPath(id), meta);
    this._upsertIndexEntry(meta);
    const layout = this._loadLayout(id);
    return { meta, layout: layout.layout, recovered: layout.recovered };
  }

  /** Persist a layout (atomic), rotating the prior good copy to .bak first. */
  saveLayout(id, layout) {
    if (!existsSync(this._dir(id))) throw notFound(`workspace not found: ${id}`);
    const validated = validateLayout(layout);
    const path = this._layoutPath(id);
    if (existsSync(path)) {
      try { copyFileSync(path, path + '.bak'); } catch { /* best-effort backup */ }
    }
    writeJsonAtomic(path, validated);
    return validated;
  }

  /** Release this process's lock. Safe to call when not open. */
  closeWorkspace(id) {
    const held = this._openLocks.get(id);
    if (held && existsSync(held)) {
      try { rmSync(held); } catch { /* already gone */ }
    }
    this._openLocks.delete(id);
  }

  /** Archive (hide from default list) without deleting on-disk data. */
  archiveWorkspace(id) {
    const meta = this._readMeta(id);
    meta.archived = true;
    writeJsonAtomic(this._metaPath(id), meta);
    this._upsertIndexEntry(meta);
    return meta;
  }

  /** A sanitized, portable bundle of a workspace — never carries secrets. */
  exportWorkspace(id) {
    const meta = this._readMeta(id);
    const { layout } = this._loadLayout(id);
    return scrubSecrets({ meta, layout, exportedAt: new Date().toISOString() });
  }

  // -- layout loading + recovery -----------------------------------------

  _loadLayout(id) {
    const path = this._layoutPath(id);
    try {
      if (existsSync(path)) return { layout: validateLayout(readJson(path)), recovered: false };
    } catch {
      // primary is corrupt — fall through to backup recovery
    }
    // try the backup
    const bak = path + '.bak';
    try {
      if (existsSync(bak)) {
        const recovered = validateLayout(readJson(bak));
        // quarantine the corrupt primary so we don't loop on it, then restore
        try { renameSync(path, path + '.corrupt'); } catch { /* may not exist */ }
        writeJsonAtomic(path, recovered);
        return { layout: recovered, recovered: true };
      }
    } catch {
      // backup is also unreadable
    }
    // nothing salvageable — start fresh but flag it so the UI can warn
    const fresh = emptyLayout();
    if (existsSync(path)) {
      try { renameSync(path, path + '.corrupt'); } catch { /* ignore */ }
    }
    writeJsonAtomic(path, fresh);
    return { layout: fresh, recovered: existsSync(path + '.corrupt') };
  }

  // -- single-open lock ---------------------------------------------------

  _acquireLock(id) {
    const lockPath = this._lockPath(id);
    if (this._openLocks.has(id)) return; // this store already holds it → idempotent re-open
    if (existsSync(lockPath)) {
      let holder = null;
      try { holder = readJson(lockPath); } catch { holder = null; }
      if (holder && this._isLockLive(holder)) {
        throw new CodeSurfError(Codes.WORKSPACE_LOCKED,
          `workspace ${id} is already open`, { holder });
      }
      // stale lock (dead pid or foreign host with no live proof) — steal it
    }
    const lock = { pid: process.pid, host: hostname(), at: new Date().toISOString() };
    writeJsonAtomic(lockPath, lock);
    this._openLocks.set(id, lockPath);
  }

  _isLockLive(holder) {
    if (!holder || typeof holder.pid !== 'number') return false;
    // We can only probe liveness for a process on this same host.
    if (holder.host && holder.host !== hostname()) return true; // assume live; can't prove dead
    if (holder.pid === process.pid) return true; // our own lock
    try {
      process.kill(holder.pid, 0); // signal 0 = existence check, doesn't kill
      return true;
    } catch (err) {
      return err.code === 'EPERM'; // exists but not ours → still live
    }
  }
}

// ---- layout validation ---------------------------------------------------

/** Coerce/validate a layout into the canonical shape; throws BAD_REQUEST on garbage. */
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object') throw badRequest('layout must be an object');
  const vp = layout.viewport && typeof layout.viewport === 'object' ? layout.viewport : {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  if (!Array.isArray(layout.tiles)) throw badRequest('layout.tiles must be an array');
  if (!Array.isArray(layout.links)) throw badRequest('layout.links must be an array');
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    viewport: { x: num(vp.x, 0), y: num(vp.y, 0), zoom: num(vp.zoom, 1) },
    tiles: layout.tiles,
    links: layout.links,
  };
}
