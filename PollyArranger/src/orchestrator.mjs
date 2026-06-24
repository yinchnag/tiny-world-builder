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
        const location = services.worktree.create({ item, roles });
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
        if (isFix) {
          services.git.push({ item });
          return { agent };
        }
        // First successful build: run gates, open the PR.
        const gates = services.gates.run({ item });
        const pr = services.git.openPR({ item });
        return { agent, gates, pr };
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
        services.git.merge({ item });
        services.worktree.teardown({ item });
        return { mergedAt: clock() };
      }

      default:
        return {};
    }
  }

  // One pass over all items. Returns true if anything changed (drove progress).
  async function tick() {
    const reg = store.load(registryPath);
    const policy = { ...reg.policy, vendors: reg.vendors };
    const concurrency = policy.concurrency ?? Infinity;
    let changed = false;

    for (let i = 0; i < reg.items.length; i += 1) {
      const item = reg.items[i];
      const action = nextAction(item, policy);
      if (!action) continue;

      // Concurrency only gates STARTING new work — items already in flight always
      // get to advance (docs/01 section 2.1).
      if (action === ACTIONS.START) {
        const inFlight = reg.items.filter((it) => ACTIVE.includes(it.status)).length;
        if (inFlight >= concurrency) continue;
      }

      const outcome = await execute(action, item, policy);
      reg.items[i] = applyResult(item, action, outcome, { now: clock, policy });
      changed = true;
    }

    if (changed) store.save(registryPath, reg);
    return changed;
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
