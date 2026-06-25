// Review history (audit trail): every implement lap + review round is appended
// to item.history (never overwritten), so a finished item carries the full
// back-and-forth.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyResult, ACTIONS, STATES } from '../src/state-machine.mjs';
import { formatHistory } from '../src/status.mjs';

const ctx = { now: () => '2026-06-25T12:00:00Z', policy: { maxReviewRounds: 3 } };

test('history records each implement lap and review round in order', () => {
  let item = { id: 'p1', title: 'demo', status: STATES.BUILDING, implementer: 'claude_code', reviewer: 'deepseek' };

  // build
  item = applyResult(item, ACTIONS.IMPLEMENT, { agent: { ok: true, convId: 'c', commits: ['a1'], summary: 'built it' }, pr: 7 }, ctx);
  // review #1 BLOCKING
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING', findings: [{ severity: 'blocking', where: 'x.js:1', what: 'bug' }] } }, ctx);
  // fix
  item = applyResult(item, ACTIONS.IMPLEMENT, { agent: { ok: true, convId: 'c', commits: ['a2'], summary: 'fixed it' } }, ctx);
  // review #2 CLEAN
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'CLEAN', findings: [] } }, ctx);

  assert.equal(item.history.length, 4);
  assert.deepEqual(item.history.map((h) => h.kind), ['implement', 'review', 'implement', 'review']);
  assert.equal(item.history[0].verb, 'build');
  assert.equal(item.history[1].verdict, 'BLOCKING');
  assert.equal(item.history[1].round, 1);
  assert.equal(item.history[2].verb, 'fix');
  assert.equal(item.history[3].verdict, 'CLEAN');
  assert.equal(item.history[3].round, 2);
  // the BLOCKING round's findings are preserved even though item.review is now CLEAN
  assert.equal(item.review.verdict, 'CLEAN');
  assert.equal(item.history[1].findings[0].what, 'bug');
});

test('formatHistory renders the back-and-forth with verdicts + findings', () => {
  const item = {
    id: 'p1', title: 'pong', status: STATES.BLOCKED, implementer: 'claude_code', reviewer: 'deepseek',
    history: [
      { kind: 'implement', verb: 'build', by: 'claude_code', summary: 'wrote game', commits: ['a1'] },
      { kind: 'review', round: 1, by: 'deepseek', verdict: 'BLOCKING', findings: [{ severity: 'blocking', where: 'collide', what: 'ball passes through paddle' }] },
    ],
  };
  const out = formatHistory(item);
  assert.match(out, /build by claude_code: wrote game/);
  assert.match(out, /review #1 by deepseek: BLOCKING/);
  assert.match(out, /ball passes through paddle/);
});
