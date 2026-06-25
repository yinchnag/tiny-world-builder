// registry/schema.mjs — validate the registry, the single source of truth.
//
// Tutorial note:
//   The registry is only trustworthy if every write is checked. These are the
//   invariants from docs/02-data-model.md section 7. validateRegistry() collects
//   every problem (so you see them all at once); assertValidRegistry() throws.
//   The store calls assertValidRegistry on every save, so a malformed state can
//   never reach disk.
//
//   Pure module: no I/O. _comment fields anywhere are ignored (they're docs).

import { STATES } from '../state-machine.mjs';

const LEGAL_STATES = new Set(Object.values(STATES));

// branch convention: polly/<id>-<slug>, e.g. polly/p8-github-stars
export const BRANCH_RE = /^polly\/[a-z0-9]+(?:-[a-z0-9]+)+$/;

// States in which the worktree must exist (created at START, torn down at MERGE).
const WORKTREE_REQUIRED = new Set([
  STATES.BUILDING, STATES.IN_REVIEW, STATES.FIXING,
  STATES.RE_REVIEW, STATES.READY_FOR_HUMAN_MERGE,
]);

// States that imply a PR has been opened. FIXING is NOT here: a red gate (①)
// sends an item to FIXING *before* any PR exists. RE_REVIEW onward do require a
// PR. BLOCKED is exempt (it can happen before a PR exists).
const PR_REQUIRED = new Set([
  STATES.RE_REVIEW, STATES.READY_FOR_HUMAN_MERGE, STATES.MERGED,
]);

/** Validate one item. Returns an array of human-readable error strings (empty = ok). */
export function validateItem(item, index = 0) {
  const errors = [];
  const tag = `items[${index}] (${item?.id ?? 'no-id'})`;

  if (!item || typeof item !== 'object') return [`${tag}: not an object`];
  if (!item.id) errors.push(`${tag}: missing id`);
  if (!item.title) errors.push(`${tag}: missing title`);

  if (!LEGAL_STATES.has(item.status)) {
    errors.push(`${tag}: illegal status "${item.status}"`);
  }

  // The defining rule of Polly: implementer and reviewer must differ.
  if (item.implementer && item.reviewer && item.implementer === item.reviewer) {
    errors.push(`${tag}: implementer and reviewer must differ (both "${item.implementer}")`);
  }

  if (item.branch != null && !BRANCH_RE.test(item.branch)) {
    errors.push(`${tag}: branch "${item.branch}" does not match polly/<id>-<slug>`);
  }

  if (WORKTREE_REQUIRED.has(item.status) && !item.worktree) {
    errors.push(`${tag}: status ${item.status} requires a worktree`);
  }
  if (WORKTREE_REQUIRED.has(item.status) && !item.branch) {
    errors.push(`${tag}: status ${item.status} requires a branch`);
  }

  if (PR_REQUIRED.has(item.status) && item.pr == null) {
    errors.push(`${tag}: status ${item.status} requires a pr number`);
  }

  return errors;
}

/** Validate the whole registry. Returns { ok, errors }. */
export function validateRegistry(reg) {
  const errors = [];
  if (!reg || typeof reg !== 'object') return { ok: false, errors: ['registry: not an object'] };
  if (reg.version !== 1) errors.push(`registry: unsupported version ${reg.version}`);
  if (!Array.isArray(reg.items)) errors.push('registry: items must be an array');
  if (reg.policy && reg.policy.merge && !['human', 'auto'].includes(reg.policy.merge)) {
    errors.push(`registry: policy.merge must be "human" or "auto"`);
  }

  if (Array.isArray(reg.items)) {
    reg.items.forEach((item, i) => errors.push(...validateItem(item, i)));
  }

  return { ok: errors.length === 0, errors };
}

/** Throw if the registry is invalid. Used by the store before every write. */
export function assertValidRegistry(reg) {
  const { ok, errors } = validateRegistry(reg);
  if (!ok) {
    throw new Error(`Invalid registry:\n  - ${errors.join('\n  - ')}`);
  }
  return reg;
}
