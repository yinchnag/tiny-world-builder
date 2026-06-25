// orchestrator.mjs — the controller loop (docs/01 section 2.1, docs/03 section 5).
//
// Tutorial note:
//   This is the ONLY part of Polly with side effects, and it is deliberately
//   dumb. Each tick it:
//     1. loads the registry (single source of truth),
//     2. for each non-terminal item, asks the state machine `nextAction()`,
//     3. EXECUTES that action (the only place agents/git/worktrees are touched),
//     4. feeds the outcome to the pure `applyResult()` to get the new state,
//     5. saves the registry.
//   Because it reloads from disk each tick and saves after every change, the
//   loop is fully resumable: kill it anywhere, restart, and it continues.
//
//   All *decisions* live in state-machine.mjs; all *I/O* lives here. That split
//   is what lets the decision logic be unit-tested with zero side effects.

import {
  ACTIONS,
  ACTIVE,
  STATES,
  nextAction,
  applyResult,
  assignRoles,
  fixSpecFromReview,
  depGate,
} from './state-machine.mjs';

/**
 * @param {object} deps
 * @param {{load:Function, save:Function}} deps.store  - registry store
 * @param {string} deps.registryPath                   - path to the registry file
 * @param {Record<string, object>} deps.adapters       - vendor -> agent adapter
 * @param {object} deps.services                        - { worktree, git, gates }
 * @param {() => string} [deps.now]                     - clock (inject for tests)
 * @param {Record<string,string>} [deps.families]       - vendor -> family map
 */
export function createOrchestrator({
  store,
  registryPath,
  adapters,
  services,
  now,
  families,
}) {
  const clock = now ?? (() => new Date().toISOString());

  // Perform an action's side effects and return a raw outcome for applyResult.
  async function execute(action, item, policy) {
    switch (action) {
      case ACTIONS.START: {
        const roles = assignRoles(policy.vendors ?? Object.keys(adapters), families);
        const location = await services.worktree.create({ item, roles });
        return { roles, location };
      }

      case ACTIONS.IMPLEMENT: {
        const adapter = adapters[item.implementer];
        if (!adapter) throw new Error(`no adapter for implementer "${item.implementer}"`);
        const isFix = item.status === STATES.FIXING;
        const spec = isFix ? fixSpecFromReview(item) : item.spec;
        const agent = await adapter.implement({
          itemId: item.id,
          spec,
          worktreePath: item.worktree,
          base: item.base,
          resumeConvId: item.convId ?? undefined,
        });
        if (!agent.ok) return { agent };

        // ① Run gates on EVERY lap. Open the PR only when gates are green and no
        // PR exists yet; a red gate must not produce a PR (the state machine
        // routes it back to FIXING). Once a PR exists, just push the fix.
        const gates = await services.gates.run({ item });
        if (gates.passed !== false && item.pr == null) {
          const pr = await services.git.openPR({ item });
          return { agent, gates, pr };
        }
        if (item.pr != null) await services.git.push({ item });
        return { agent, gates };
      }

      case ACTIONS.REVIEW: {
        const adapter = adapters[item.reviewer];
        if (!adapter) throw new Error(`no adapter for reviewer "${item.reviewer}"`);
        const review = await adapter.review({
          itemId: item.id,
          prNumber: item.pr,
          spec: item.spec,
          worktreePath: item.worktree,
        });
        return { review };
      }

      case ACTIONS.MERGE: {
        // S2 — merge may conflict with the latest base. On conflict, keep the
        // worktree (for inspection/resolution) and signal it; the state machine
        // routes the item to BLOCKED instead of crashing.
        const result = await services.git.merge({ item });
        if (result && result.ok === false) {
          return { mergeConflict: result };
        }
        await services.worktree.teardown({ item });
        return { mergedAt: clock() };
      }

      default:
        return {};
    }
  }

  // Run `arr` through `fn` with at most `limit` concurrent calls (Phase 4).
  async function mapPool(arr, limit, fn) {
    const n = arr.length;
    if (n === 0) return;
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next;
        next += 1;
        await fn(arr[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, n)) }, worker));
  }

  // One pass over all items. Every item with a pending action advances ONE step;
  // up to `policy.concurrency` steps run AT ONCE (each item has its own worktree,
  // so parallel steps are safe — docs/01 section 2.1). WIP is capped: we only
  // START new items while the number of ACTIVE items is below the cap, so at most
  // `concurrency` items are in flight. Returns true if anything changed.
  async function tick() {
    const reg = store.load(registryPath);
    const policy = { ...reg.policy, vendors: reg.vendors };
    const cap = policy.concurrency ?? Infinity;

    let active = reg.items.filter((it) => ACTIVE.includes(it.status)).length;
    const statusById = Object.fromEntries(reg.items.map((it) => [it.id, it.status]));
    const pending = [];
    let changedInline = false;
    for (let i = 0; i < reg.items.length; i += 1) {
      const item = reg.items[i];
      const action = nextAction(item, policy);
      if (!action) continue;
      if (action === ACTIONS.START) {
        // S1 — dependency gate: only start once all deps are MERGED.
        const gate = depGate(item, statusById);
        if (gate.state === 'failed') {
          reg.items[i] = { ...item, status: STATES.BLOCKED, blockedOn: `Blocked by dependency: ${gate.reason}` };
          changedInline = true;
          continue;
        }
        if (gate.state === 'waiting') continue; // deps not merged yet — stay PLANNED
        if (active >= cap) continue; // WIP limit reached — leave it PLANNED
        active += 1; // reserve a slot for the item we're about to start
      }
      pending.push({ i, item, action });
    }
    if (pending.length === 0) {
      if (changedInline) store.save(registryPath, reg);
      return changedInline;
    }

    // Execute the steps concurrently (capped), then apply all results + save once.
    await mapPool(pending, cap, async (p) => {
      p.outcome = await execute(p.action, p.item, policy);
    });
    for (const p of pending) {
      reg.items[p.i] = applyResult(p.item, p.action, p.outcome, { now: clock, policy });
    }
    store.save(registryPath, reg);
    return true;
  }

  // Run ticks until the line is stable (nothing left to do automatically).
  // onTick(reg, t) is called after each tick — handy for demos/observability.
  async function run({ maxTicks = 100, onTick } = {}) {
    let reg;
    for (let t = 0; t < maxTicks; t += 1) {
      const changed = await tick();
      reg = store.load(registryPath);
      if (onTick) onTick(reg, t);
      if (!changed) break;
    }
    return reg ?? store.load(registryPath);
  }

  return { tick, run, execute };
}
