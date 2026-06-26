// CodeSurf facade — resolves the on-disk data directory and exposes the
// workspace store. The HTTP shell + canvas (M2) will build on top of this.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { WorkspaceStore } from './store.mjs';

/** Default per-user data directory for CodeSurf workspaces. */
export function defaultDataDir() {
  if (process.env.CODESURF_DATA_DIR) return process.env.CODESURF_DATA_DIR;
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : (process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'));
  return join(base, 'CodeSurf', 'workspaces');
}

/** Open a CodeSurf session bound to a data directory (default: per-user). */
export function openCodeSurf({ dataDir } = {}) {
  const store = new WorkspaceStore(dataDir || defaultDataDir());
  return { store };
}

export { WorkspaceStore };
