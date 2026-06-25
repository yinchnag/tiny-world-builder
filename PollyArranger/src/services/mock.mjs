// services/mock.mjs — fake worktree / git / gates for Phase 1 (no real git).
//
// Tutorial note:
//   The orchestrator depends on three SIDE-EFFECT services:
//     worktree — create/teardown an isolated checkout (docs/01 section 2.3)
//     git      — open PRs, push, merge          (docs/01 section 2.5)
//     gates    — run static checks              (parent project's `npm test`)
//   In Phase 1 these are mocked so the loop's STRUCTURE is real while nothing
//   actually touches git. Phase 2 swaps in real implementations behind the exact
//   same interface — the orchestrator never changes.

import { slugify } from '../util/slug.mjs';

export { slugify }; // re-exported so existing imports keep working

/** Create the mock service bundle. PR numbers increment from a base. */
export function createMockServices({ prStart = 100 } = {}) {
  let prSeq = prStart;
  return {
    worktree: {
      create({ item }) {
        const slug = slugify(item.title);
        return {
          branch: `polly/${item.id}-${slug}`,
          worktree: `.worktrees/${item.id}-${slug}`,
          base: 'origin/main mock0000',
        };
      },
      teardown(/* { item } */) {
        /* no-op in mock */
      },
    },
    git: {
      openPR(/* { item } */) {
        prSeq += 1;
        return prSeq;
      },
      push(/* { item } */) {
        /* no-op in mock */
      },
      merge(/* { item } */) {
        return { ok: true }; // mock always merges cleanly (override in tests to simulate a conflict)
      },
    },
    gates: {
      run(/* { item } */) {
        return { check: true, test: true, build: true };
      },
    },
  };
}
