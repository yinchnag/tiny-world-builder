// registry/store.mjs — read/write the registry file, the single source of truth.
//
// Tutorial note:
//   Two guarantees matter here (docs/01 section 2.2):
//     1. ATOMIC writes — write to a temp file, then rename over the target.
//        A crash mid-write can never leave a half-written registry, because
//        rename() is atomic on every real filesystem.
//     2. VALIDATED writes — assertValidRegistry() runs before we touch disk, so
//        a malformed state can never be persisted.
//
//   The orchestrator load()s at the start of every tick and save()s after every
//   change. That read-modify-write-through-a-file pattern is exactly what makes
//   Polly resumable: kill it anywhere and the file is always a consistent state.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertValidRegistry } from './schema.mjs';

/** A fresh, empty, valid registry. */
export function createEmptyRegistry(overrides = {}) {
  return {
    version: 1,
    vendors: ['claude_code', 'codex'],
    policy: { merge: 'human', maxReviewRounds: 3, maxGateRounds: 3, concurrency: 4 },
    waves: [],
    items: [],
    notes: [],
    ...overrides,
  };
}

/** Load + parse a registry from disk. Does not mutate. */
export function loadRegistry(path) {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Validate, then atomically write the registry to disk.
 * Creates the parent directory if needed.
 */
export function saveRegistry(path, reg) {
  assertValidRegistry(reg);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
  renameSync(tmp, path); // atomic swap
  return reg;
}

/** Convenience: a store object with the shape the orchestrator expects. */
export function createFileStore() {
  return { load: loadRegistry, save: saveRegistry };
}
