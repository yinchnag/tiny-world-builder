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

/** Default vendor -> model-family map, for cross-family role assignment. */
export const DEFAULT_FAMILIES = Object.freeze({
  claude_code: 'anthropic',
  openclaude: 'anthropic',
  codex: 'openai',
  cursor: 'cursor',
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
      if (!res || !res.ok) {
        // The implementer hard-failed. Don't loop — abandon (docs/03 section 3).
        return { ...item, status: STATES.ABANDONED };
      }
      if (item.status === STATES.BUILDING) {
        // First build succeeded -> gates ran, PR opened -> go to review.
        return {
          ...item,
          convId: res.convId ?? item.convId,
          commits: res.commits ?? [],
          gates: outcome.gates ?? null,
          pr: outcome.pr ?? item.pr,
          status: STATES.IN_REVIEW,
        };
      }
      // Otherwise this was a FIXING lap -> fixes pushed -> back to review.
      return {
        ...item,
        convId: res.convId ?? item.convId,
        commits: res.commits ?? item.commits ?? [],
        status: STATES.RE_REVIEW,
      };
    }

    case ACTIONS.REVIEW: {
      const r = outcome.review;
      const round = (item.reviewRound ?? 0) + 1;
      const next = {
        ...item,
        reviewConvId: r.convId ?? item.reviewConvId,
        reviewRound: round,
        review: { verdict: r.verdict, round, findings: r.findings ?? [] },
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
