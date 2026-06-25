// memory.mjs — persistent project memory (S5).
//
// Tutorial note:
//   Each task otherwise starts cold from the worktree. Project memory is a small
//   human-editable file (`.polly/memory.md`) of durable decisions/conventions that
//   gets injected into the implementer's (and reviewer's) prompt, so later tasks
//   respect earlier choices. Optionally a "scribe" appends a one-line record when
//   a task merges (no extra model call — it reuses the implement summary). It's
//   append-only + bounded + meant to be curated by a human.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HEADER = '# Project memory\n\n_Conventions, decisions, gotchas. Injected into agent prompts; auto-appended on merge when `--scribe` is on; edit freely._\n\n';

/** File-backed project memory at `path` (e.g. <repo>/.polly/memory.md). */
export function createFileMemory(path) {
  return {
    path,
    read() {
      try { return readFileSync(path, 'utf8'); } catch { return ''; }
    },
    append(text) {
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) writeFileSync(path, HEADER, 'utf8');
      appendFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    },
  };
}

/** In-memory project memory — for tests (no filesystem). */
export function createInMemoryMemory(initial = '') {
  let buf = initial;
  return {
    path: 'memory',
    read: () => buf,
    append: (text) => { buf += text.endsWith('\n') ? text : `${text}\n`; },
  };
}
