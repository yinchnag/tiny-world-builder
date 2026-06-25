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
export function newPlannedItem({ id, title, spec, wave = null, createdAt = null, dependsOn = [], tags = [] }) {
  return {
    id,
    wave,
    title,
    spec: spec ?? title,
    dependsOn, // S1 — ids that must be MERGED before this starts
    tags, // S3 — routing input (tag → vendor)
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
  const existingIds = new Set(reg.items.map((i) => i.id));
  for (const e of entries) {
    const title = typeof e === 'string' ? e : e.title;
    const spec = typeof e === 'string' ? e : (e.spec ?? e.title);
    const dependsOn = typeof e === 'string' ? [] : (e.dependsOn ?? []);
    const tags = typeof e === 'string' ? [] : (e.tags ?? []);
    // Explicit id (so deps can reference it) or auto p<n>. Explicit ids must be
    // branch-safe (lowercase alnum) since the branch is polly/<id>-<slug>.
    let id;
    if (typeof e === 'object' && e.id != null) {
      id = String(e.id);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`item id "${id}" must be kebab-case (lowercase letters, digits, hyphens)`);
      if (existingIds.has(id)) throw new Error(`duplicate item id "${id}"`);
    } else {
      n += 1;
      id = `${idPrefix}${n}`;
    }
    existingIds.add(id);
    const item = newPlannedItem({ id, title, spec, wave, createdAt, dependsOn, tags });
    reg.items.push(item);
    created.push(item);
  }
  // S1 — reject unknown dependencies and cycles up front (fail fast at seed time).
  validateDependencies(reg.items);
  return created;
}

/** Throw if any dependsOn references a missing item, or if there's a cycle. */
export function validateDependencies(items) {
  const ids = new Set(items.map((i) => i.id));
  for (const it of items) {
    for (const d of it.dependsOn ?? []) {
      if (!ids.has(d)) throw new Error(`item "${it.id}" dependsOn unknown item "${d}"`);
    }
  }
  const cycle = detectCycle(items);
  if (cycle) throw new Error(`dependency cycle: ${cycle.join(' -> ')}`);
}

/** Return a cycle (array of ids) in the dependsOn graph, or null if acyclic. */
export function detectCycle(items) {
  const adj = new Map(items.map((i) => [i.id, (i.dependsOn ?? []).filter((d) => items.some((x) => x.id === d))]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...adj.keys()].map((k) => [k, WHITE]));
  const stack = [];
  let found = null;
  const dfs = (u) => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) { found = [...stack.slice(stack.indexOf(v)), v]; return true; }
      if (color.get(v) === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    stack.pop();
    return false;
  };
  for (const k of adj.keys()) {
    if (color.get(k) === WHITE && dfs(k)) return found;
  }
  return null;
}
