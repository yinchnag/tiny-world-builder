// state-machine.mjs — the heart of Polly, as PURE FUNCTIONS (no I/O).
//
// Tutorial note:
//   Per docs/03-state-machine.md, the orchestrator never decides *what* to do —
//   it asks this module. Everything here is a pure function of its inputs:
//   no file reads, no agent calls, no git. That is deliberate — it means the
//   entire decision logic of Polly can be unit-tested with zero side effects
//   (see test/state-machine.test.mjs).
//
//   Two functions carry the logic:
//     nextAction(item, policy)  -> which ACTION this item needs next (or null)
//     applyResult(item, action, outcome, ctx) -> the item's NEW state
//   The orchestrator (orchestrator.mjs) is the thin I/O layer between them: it
//   performs the action's side effects and feeds the outcome back here.

/** All legal item states. See docs/03-state-machine.md section 1. */
export const STATES = Object.freeze({
  PLANNED: 'PLANNED',
  BUILDING: 'BUILDING',
  IN_REVIEW: 'IN_REVIEW',
  FIXING: 'FIXING',
  RE_REVIEW: 'RE_REVIEW',
  READY_FOR_HUMAN_MERGE: 'READY_FOR_HUMAN_MERGE',
  MERGED: 'MERGED',
  BLOCKED: 'BLOCKED',
  ABANDONED: 'ABANDONED',
});

/** The actions the orchestrator can be told to perform. */
export const ACTIONS = Object.freeze({
  START: 'START', // assign roles + create worktree, then begin building
  IMPLEMENT: 'IMPLEMENT', // dispatch the implementer (first build OR a fix lap)
  REVIEW: 'REVIEW', // dispatch the reviewer
  MERGE: 'MERGE', // merge (only under auto-merge policy)
});

/** Terminal states — nothing further happens. */
export const TERMINAL = Object.freeze([STATES.MERGED, STATES.ABANDONED]);

/** Waiting-on-human states — the loop does nothing automatically. */
export const WAITING = Object.freeze([STATES.READY_FOR_HUMAN_MERGE, STATES.BLOCKED]);

/** Active states — an agent is (conceptually) working; counts toward concurrency. */
export const ACTIVE = Object.freeze([
  STATES.BUILDING, STATES.IN_REVIEW, STATES.FIXING, STATES.RE_REVIEW,
]);

/**
 * Default vendor -> model-family map, for cross-family role assignment.
 * Families exist so assignRoles() can pick a reviewer from a DIFFERENT family
 * than the implementer (genuinely independent review — docs/00 section 2).
 * Add a provider here when you add its adapter (docs/04 section 3).
 */
export const DEFAULT_FAMILIES = Object.freeze({
  // coding-agent harnesses
  claude_code: 'anthropic',
  openclaude: 'anthropic',
  codex: 'openai',
  cursor: 'cursor',
  // raw LLM APIs (via the openai-compatible adapter)
  deepseek: 'deepseek',
  openai: 'openai',
  minimax: 'minimax',
  kimi: 'kimi', // Moonshot
  qwen: 'qwen', // Alibaba
  glm: 'glm', // Zhipu
});

export function isTerminal(status) {
  return TERMINAL.includes(status);
}

/**
 * Decide the next ACTION for an item given the pipeline policy.
 * Returns null when there is nothing to do automatically (terminal, or waiting
 * on a human). This is the transition table from docs/03 section 3, read as
 * "given my current status, what does the orchestrator do next?".
 */
export function nextAction(item, policy = {}) {
  switch (item.status) {
    case STATES.PLANNED:
      return ACTIONS.START;
    case STATES.BUILDING:
      return ACTIONS.IMPLEMENT;
    case STATES.FIXING:
      return ACTIONS.IMPLEMENT; // a fix lap is just IMPLEMENT again
    case STATES.IN_REVIEW:
      return ACTIONS.REVIEW;
    case STATES.RE_REVIEW:
      return ACTIONS.REVIEW; // re-review is just REVIEW again
    case STATES.READY_FOR_HUMAN_MERGE:
      // Default policy parks here and waits for a human. Auto-merge is opt-in.
      return policy.merge === 'auto' ? ACTIONS.MERGE : null;
    default:
      return null; // MERGED / ABANDONED / BLOCKED -> nothing automatic
  }
}

/**
 * S1 — dependency gate. Given an item and a map of id→status for the registry,
 * decide whether the item may START:
 *   'ready'   — all dependsOn are MERGED (or there are none) → may start
 *   'waiting' — some dependency hasn't merged yet (incl. a BLOCKED dep a human
 *               might still resolve) → leave it PLANNED
 *   'failed'  — a dependency is ABANDONED or missing → the dependent can never
 *               proceed → the orchestrator marks it BLOCKED
 * Pure: the orchestrator supplies the status map (cross-item info isn't in nextAction).
 */
export function depGate(item, statusById) {
  const deps = item.dependsOn ?? [];
  if (deps.length === 0) return { state: 'ready' };
  for (const d of deps) {
    const s = statusById[d];
    if (s === undefined) return { state: 'failed', dep: d, reason: `dependency "${d}" not found` };
    if (s === STATES.ABANDONED) return { state: 'failed', dep: d, reason: `dependency "${d}" was abandoned` };
  }
  const allMerged = deps.every((d) => statusById[d] === STATES.MERGED);
  return allMerged ? { state: 'ready' } : { state: 'waiting' };
}

/**
 * Assign implementer + reviewer to an item. HARD RULE: they must differ, and we
 * prefer a reviewer from a *different model family* so the review is genuinely
 * independent (docs/00 section 2, docs/04 section 4).
 *
 * Phase 1 uses a simple deterministic policy (first vendor implements; first
 * different-family vendor reviews). Load-based routing is a Phase 4 concern.
 */
export function assignRoles(vendors, families = DEFAULT_FAMILIES) {
  if (!Array.isArray(vendors) || vendors.length < 2) {
    throw new Error('assignRoles: need at least 2 vendors (implementer + reviewer)');
  }
  const implementer = vendors[0];
  const implFamily = families[implementer];
  let reviewer = vendors.find((v) => v !== implementer && families[v] !== implFamily);
  if (!reviewer) reviewer = vendors.find((v) => v !== implementer); // fallback: just different
  if (!reviewer) throw new Error('assignRoles: cannot find a distinct reviewer');
  return { implementer, reviewer };
}

/**
 * Fold an adapter's token usage into an item's running cost. Returns the prior
 * cost unchanged when there's no usage (e.g. mock adapters), so a `cost` field
 * only appears once a real model has been called.
 */
export function mergeCost(prev, usage) {
  if (!usage) return prev;
  const base = prev ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  return {
    calls: base.calls + (usage.calls ?? 0),
    promptTokens: base.promptTokens + (usage.promptTokens ?? 0),
    completionTokens: base.completionTokens + (usage.completionTokens ?? 0),
    totalTokens: base.totalTokens + (usage.totalTokens ?? 0),
  };
}

/**
 * Append an entry to an item's audit trail (`item.history`), never mutating.
 * The history records every implement lap and every review round in order, so a
 * BLOCKED/finished item carries the full back-and-forth (who did/said what each
 * round) instead of only the latest review.
 */
export function appendHistory(item, entry, now) {
  return [...(item.history ?? []), { at: now, ...entry }];
}

/** Build the fix instruction handed to the implementer on a fix lap. */
export function fixSpecFromReview(item) {
  const findings = item.review?.findings ?? [];
  if (findings.length === 0) return `Address the review feedback for ${item.id}.`;
  const list = findings
    .map((f, i) => `(${i + 1}) ${f.where ?? '?'}: ${f.what ?? ''}`)
    .join('; ');
  return `Fix review findings: ${list}`;
}

/**
 * Compute the item's NEW state after an action's outcome. Pure: given the same
 * item + action + outcome it always returns the same next item. The orchestrator
 * persists whatever this returns.
 *
 * ctx: { now?: () => isoString, policy?: {...} }
 */
export function applyResult(item, action, outcome, ctx = {}) {
  const now = ctx.now ? ctx.now() : new Date().toISOString();
  const policy = ctx.policy ?? {};

  switch (action) {
    case ACTIONS.START: {
      const { roles, location } = outcome;
      return {
        ...item,
        implementer: roles.implementer,
        reviewer: roles.reviewer,
        branch: location.branch,
        worktree: location.worktree,
        base: location.base,
        status: STATES.BUILDING,
      };
    }

    case ACTIONS.IMPLEMENT: {
      const res = outcome.agent;
      const cost = mergeCost(item.cost, res?.usage); // accrue tokens even on failure
      if (!res || !res.ok) {
        // The implementer hard-failed. Don't loop — abandon (docs/03 section 3).
        return { ...item, cost, status: STATES.ABANDONED };
      }
      const gates = outcome.gates ?? null;
      const commits = res.commits ?? item.commits ?? [];
      const convId = res.convId ?? item.convId;
      // Audit trail (review history): record this implement lap.
      const history = appendHistory(item, {
        kind: 'implement',
        verb: item.status === STATES.BUILDING ? 'build' : 'fix',
        by: item.implementer,
        summary: res.summary ?? '',
        commits: res.commits ?? [],
      }, now);

      // ① RED GATE BLOCKS: a failing gate sends the item back to FIXING (never to
      // review, never opening a PR), bounded by maxGateRounds, then escalates to
      // BLOCKED. Mock gates lack a `passed` field → treated as pass → no block.
      if (gates && gates.passed === false) {
        const gateRound = (item.gateRound ?? 0) + 1;
        const cap = policy.maxGateRounds ?? policy.maxReviewRounds ?? 3;
        const findings = [{
          severity: 'blocking',
          where: gates.command ?? 'gates',
          what: `gates failed${gates.output ? `:\n${gates.output}` : ''}`,
        }];
        if (gateRound >= cap) {
          return {
            ...item, cost, gates, gateRound, history,
            status: STATES.BLOCKED,
            blockedOn: `Gates still failing after ${gateRound} attempt(s) — escalated to a human.`,
          };
        }
        return {
          ...item, cost, gates, gateRound, convId, commits, history,
          review: { verdict: 'BLOCKING', round: item.review?.round ?? 0, findings },
          status: STATES.FIXING,
        };
      }

      // Gates passed (or absent). First time the PR opens; thereafter re-review.
      if (item.status === STATES.BUILDING || item.pr == null) {
        // BUILDING, or a FIXING lap that recovered from an earlier red gate (no
        // PR yet) — the PR is opened now -> go to review.
        return {
          ...item, cost, convId, commits, gates, history,
          pr: outcome.pr ?? item.pr,
          status: STATES.IN_REVIEW,
        };
      }
      // A normal fix lap (PR already open) -> back to review.
      return { ...item, cost, convId, commits, gates, history, status: STATES.RE_REVIEW };
    }

    case ACTIONS.REVIEW: {
      const r = outcome.review;
      const round = (item.reviewRound ?? 0) + 1;
      const next = {
        ...item,
        cost: mergeCost(item.cost, r?.usage),
        reviewConvId: r.convId ?? item.reviewConvId,
        reviewRound: round,
        review: { verdict: r.verdict, round, findings: r.findings ?? [] },
        // Audit trail: append this review round (never overwrite prior rounds).
        history: appendHistory(item, {
          kind: 'review', round, by: item.reviewer,
          verdict: r.verdict, findings: r.findings ?? [],
        }, now),
      };
      if (r.verdict === 'BLOCKING') {
        const max = policy.maxReviewRounds ?? 3;
        if (round >= max) {
          // Don't loop forever (docs/03 section 4, rule 1) — escalate to a human.
          return {
            ...next,
            status: STATES.BLOCKED,
            blockedOn: `Review still BLOCKING after ${round} round(s) — escalated to a human.`,
          };
        }
        return { ...next, status: STATES.FIXING };
      }
      // CLEAN or NON_BLOCKING -> park at the human merge gate.
      return { ...next, status: STATES.READY_FOR_HUMAN_MERGE };
    }

    case ACTIONS.MERGE: {
      // S2 — a conflicting merge doesn't merge; it parks the item for a human
      // (the worktree is kept so the conflict can be resolved).
      if (outcome.mergeConflict) {
        const files = outcome.mergeConflict.conflicts ?? [];
        return {
          ...item,
          status: STATES.BLOCKED,
          blockedOn: `Merge conflict with ${item.base ?? 'base'}`
            + (files.length ? ` in: ${files.join(', ')}` : '')
            + (outcome.mergeConflict.reason ? ` — ${outcome.mergeConflict.reason}` : ''),
        };
      }
      return {
        ...item,
        status: STATES.MERGED,
        mergedAt: outcome.mergedAt ?? now,
        worktree: null, // torn down on merge
      };
    }

    default:
      return item;
  }
}
