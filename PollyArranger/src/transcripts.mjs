// transcripts.mjs — persist an agent conversation per convId (⑤).
//
// Tutorial note:
//   Raw LLM APIs are stateless — they remember nothing between calls. Before this,
//   a fix lap started a fresh conversation and relied on re-reading the worktree
//   ("soft resume"). With a transcript store, the implementer's FULL conversation
//   (system prompt, the spec, every tool call + result) is saved under its convId
//   and re-loaded on the fix lap, so the model genuinely continues where it left
//   off — it remembers what it built and why, which makes fixes sharper.
//
//   Two stores: a file store (real runs) and an in-memory store (tests).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const safe = (convId) => String(convId).replace(/[^a-zA-Z0-9_-]/g, '_');

/** File-backed transcript store under `dir`. One JSON file per convId. */
export function createFileTranscriptStore(dir) {
  const pathFor = (convId) => join(dir, `${safe(convId)}.json`);
  return {
    pathFor,
    load(convId) {
      const p = pathFor(convId);
      if (!existsSync(p)) return null;
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        return null; // corrupt transcript → start fresh
      }
    },
    save(convId, messages) {
      mkdirSync(dir, { recursive: true });
      const p = pathFor(convId);
      const tmp = `${p}.tmp`;
      writeFileSync(tmp, JSON.stringify(messages, null, 2), 'utf8'); // atomic write
      renameSync(tmp, p);
    },
  };
}

/** In-memory transcript store — handy for tests (no filesystem). */
export function createMemoryTranscriptStore() {
  const m = new Map();
  return {
    pathFor: (convId) => `memory:${safe(convId)}`,
    load: (convId) => m.get(convId) ?? null,
    save: (convId, messages) => { m.set(convId, messages); },
  };
}
