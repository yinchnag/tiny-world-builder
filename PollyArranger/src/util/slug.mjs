// util/slug.mjs — shared helpers for turning an item into git names.
//
// Tutorial note:
//   Both the mock services (Phase 1) and the real git services (Phase 2.1) need
//   to derive the SAME branch/worktree names from an item, so the logic lives
//   here once. The branch convention `polly/<id>-<slug>` is enforced by the
//   schema's BRANCH_RE (docs/02 section 7), so slugify must only ever produce
//   lowercase alphanumerics and single dashes.

/** Lowercase, alphanumeric, single-dash slug. Never empty. */
export function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'item'
  );
}

/** The branch name for an item: polly/<id>-<slug>. */
export function branchNameFor(item) {
  return `polly/${item.id}-${slugify(item.title)}`;
}

/** The worktree directory for an item, under `root`. */
export function worktreeDirFor(item, root = '.worktrees') {
  return `${root}/${item.id}-${slugify(item.title)}`;
}
