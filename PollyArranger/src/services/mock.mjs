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

/** Turn a title into a branch-safe slug: lowercase, alnum + single dashes. */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'item';
}

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
        /* no-op in mock */
      },
    },
    gates: {
      run(/* { item } */) {
        return { check: true, test: true, build: true };
      },
    },
  };
}
