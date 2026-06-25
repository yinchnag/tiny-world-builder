// Unit tests for the PURE state machine — no agents, no git, no files.
// This is the cheapest, most important test layer: all of Polly's decision
// logic lives in state-machine.mjs and is verified here in isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATES,
  ACTIONS,
  nextAction,
  applyResult,
  assignRoles,
  fixSpecFromReview,
} from '../src/state-machine.mjs';

const ctx = { now: () => '2026-06-24T12:00:00Z', policy: { maxReviewRounds: 3 } };

test('nextAction maps each status to the right action', () => {
  assert.equal(nextAction({ status: STATES.PLANNED }), ACTIONS.START);
  assert.equal(nextAction({ status: STATES.BUILDING }), ACTIONS.IMPLEMENT);
  assert.equal(nextAction({ status: STATES.FIXING }), ACTIONS.IMPLEMENT);
  assert.equal(nextAction({ status: STATES.IN_REVIEW }), ACTIONS.REVIEW);
  assert.equal(nextAction({ status: STATES.RE_REVIEW }), ACTIONS.REVIEW);
  // Human gate: nothing automatic by default, MERGE under auto policy.
  assert.equal(nextAction({ status: STATES.READY_FOR_HUMAN_MERGE }), null);
  assert.equal(
    nextAction({ status: STATES.READY_FOR_HUMAN_MERGE }, { merge: 'auto' }),
    ACTIONS.MERGE,
  );
  // Terminal / waiting -> nothing.
  assert.equal(nextAction({ status: STATES.MERGED }), null);
  assert.equal(nextAction({ status: STATES.ABANDONED }), null);
  assert.equal(nextAction({ status: STATES.BLOCKED }), null);
});

test('START assigns roles + location and moves to BUILDING', () => {
  const item = { id: 'p1', status: STATES.PLANNED };
  const out = applyResult(item, ACTIONS.START, {
    roles: { implementer: 'claude_code', reviewer: 'codex' },
    location: { branch: 'polly/p1-x', worktree: '.worktrees/p1-x', base: 'origin/main abc' },
  }, ctx);
  assert.equal(out.status, STATES.BUILDING);
  assert.equal(out.implementer, 'claude_code');
  assert.equal(out.reviewer, 'codex');
  assert.equal(out.branch, 'polly/p1-x');
});

test('IMPLEMENT from BUILDING (ok) opens review with a PR', () => {
  const item = { id: 'p1', status: STATES.BUILDING };
  const out = applyResult(item, ACTIONS.IMPLEMENT, {
    agent: { ok: true, convId: 'c1', commits: ['a'] },
    gates: { check: true }, pr: 42,
  }, ctx);
  assert.equal(out.status, STATES.IN_REVIEW);
  assert.equal(out.pr, 42);
  assert.equal(out.convId, 'c1');
});

test('IMPLEMENT failure abandons the item (no infinite retry)', () => {
  const item = { id: 'p1', status: STATES.BUILDING };
  const out = applyResult(item, ACTIONS.IMPLEMENT, { agent: { ok: false } }, ctx);
  assert.equal(out.status, STATES.ABANDONED);
});

test('IMPLEMENT from FIXING (ok, PR already open) goes back to RE_REVIEW', () => {
  const item = { id: 'p1', status: STATES.FIXING, convId: 'c1', pr: 42 };
  const out = applyResult(item, ACTIONS.IMPLEMENT, {
    agent: { ok: true, convId: 'c1', commits: ['a', 'b'] },
  }, ctx);
  assert.equal(out.status, STATES.RE_REVIEW);
});

test('REVIEW BLOCKING -> FIXING and increments the round', () => {
  const item = { id: 'p1', status: STATES.IN_REVIEW, reviewRound: 0 };
  const out = applyResult(item, ACTIONS.REVIEW, {
    review: { verdict: 'BLOCKING', findings: [{ where: 'x', what: 'y' }] },
  }, ctx);
  assert.equal(out.status, STATES.FIXING);
  assert.equal(out.reviewRound, 1);
  assert.equal(out.review.verdict, 'BLOCKING');
});

test('REVIEW CLEAN -> READY_FOR_HUMAN_MERGE', () => {
  const item = { id: 'p1', status: STATES.RE_REVIEW, reviewRound: 1 };
  const out = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'CLEAN' } }, ctx);
  assert.equal(out.status, STATES.READY_FOR_HUMAN_MERGE);
  assert.equal(out.reviewRound, 2);
});

test('REVIEW BLOCKING at the round cap escalates to BLOCKED (no infinite loop)', () => {
  // reviewRound 2 -> this review makes round 3 == maxReviewRounds -> escalate.
  const item = { id: 'p1', status: STATES.RE_REVIEW, reviewRound: 2 };
  const out = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING' } }, ctx);
  assert.equal(out.status, STATES.BLOCKED);
  assert.match(out.blockedOn, /escalated/i);
});

test('MERGE -> MERGED, records mergedAt, tears down worktree', () => {
  const item = { id: 'p1', status: STATES.READY_FOR_HUMAN_MERGE, worktree: '.worktrees/p1-x' };
  const out = applyResult(item, ACTIONS.MERGE, {}, ctx);
  assert.equal(out.status, STATES.MERGED);
  assert.equal(out.mergedAt, '2026-06-24T12:00:00Z');
  assert.equal(out.worktree, null);
});

test('assignRoles picks a different-family reviewer; never equal', () => {
  const { implementer, reviewer } = assignRoles(['claude_code', 'codex', 'openclaude']);
  assert.equal(implementer, 'claude_code');
  assert.equal(reviewer, 'codex'); // codex is openai-family, different from claude
  assert.notEqual(implementer, reviewer);
});

test('assignRoles throws with fewer than two vendors', () => {
  assert.throws(() => assignRoles(['claude_code']), /at least 2 vendors/);
});

test('fixSpecFromReview turns findings into an instruction', () => {
  const spec = fixSpecFromReview({
    id: 'p1',
    review: { findings: [{ where: 'a.js:1', what: 'off by one' }] },
  });
  assert.match(spec, /a\.js:1/);
  assert.match(spec, /off by one/);
});
