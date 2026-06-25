// planner.mjs — seed a backlog of specs as PLANNED items (Phase 4, item 15).
//
// Tutorial note:
//   The orchestrator consumes items; the planner produces them. Give it a list
//   of work (strings, or { title, spec } objects) and it appends fresh PLANNED
//   items to the registry with sequential ids (p1, p2, …), optionally tagged to
//   a wave. Everything else (assign roles, worktree, build, review, merge) the
//   orchestrator does from there.

import { STATES } from './state-machine.mjs';

/** A complete, valid PLANNED item with all fields defaulted. */
export function newPlannedItem({ id, title, spec, wave = null, createdAt = null }) {
  return {
    id,
    wave,
    title,
    spec: spec ?? title,
    branch: null, worktree: null, base: null, pr: null,
    implementer: null, reviewer: null, convId: null, reviewConvId: null,
    status: STATES.PLANNED, reviewRound: 0,
    createdAt, mergedAt: null, review: null, gates: null, caveats: [],
  };
}

/** Highest existing numeric suffix for ids like `<prefix><n>` (0 if none). */
function maxIdNum(items, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const it of items) {
    const m = re.exec(it.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Append PLANNED items for each backlog entry. Continues id numbering after any
 * existing `<prefix><n>` ids, so it's safe to call repeatedly.
 *
 * @param {object} reg                       - the registry (mutated)
 * @param {Array<string|{title,spec}>} entries
 * @param {object} [opts]
 * @param {string|null} [opts.wave]
 * @param {string} [opts.idPrefix='p']
 * @param {string|null} [opts.createdAt]
 * @returns {object[]} the newly created items
 */
export function seedItems(reg, entries, { wave = null, idPrefix = 'p', createdAt = null } = {}) {
  let n = maxIdNum(reg.items, idPrefix);
  const created = [];
  for (const e of entries) {
    n += 1;
    const title = typeof e === 'string' ? e : e.title;
    const spec = typeof e === 'string' ? e : (e.spec ?? e.title);
    const item = newPlannedItem({ id: `${idPrefix}${n}`, title, spec, wave, createdAt });
    reg.items.push(item);
    created.push(item);
  }
  return created;
}
