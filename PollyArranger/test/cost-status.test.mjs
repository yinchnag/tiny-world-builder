// Phase 5 — cost accounting + the status view.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyResult, ACTIONS, STATES, mergeCost } from '../src/state-machine.mjs';
import { createEmptyRegistry } from '../src/registry/store.mjs';
import { costTotals } from '../src/report.mjs';
import { formatStatus } from '../src/status.mjs';

test('mergeCost folds usage and is a no-op without usage', () => {
  assert.equal(mergeCost(undefined, undefined), undefined); // mock path → no cost field
  const c1 = mergeCost(undefined, { calls: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  assert.deepEqual(c1, { calls: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  const c2 = mergeCost(c1, { calls: 2, promptTokens: 4, completionTokens: 6, totalTokens: 10 });
  assert.deepEqual(c2, { calls: 3, promptTokens: 14, completionTokens: 11, totalTokens: 25 });
});

test('applyResult accumulates per-item cost across implement + review', () => {
  let item = { id: 'p1', status: STATES.BUILDING };
  item = applyResult(item, ACTIONS.IMPLEMENT, {
    agent: { ok: true, convId: 'c', commits: ['a'], usage: { calls: 2, promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
    pr: 1,
  });
  assert.equal(item.cost.totalTokens, 150);
  item = applyResult(item, ACTIONS.REVIEW, {
    review: { verdict: 'CLEAN', usage: { calls: 1, promptTokens: 30, completionTokens: 10, totalTokens: 40 } },
  });
  assert.equal(item.cost.totalTokens, 190);
  assert.equal(item.cost.calls, 3);
});

test('mock-driven items carry no cost field', () => {
  let item = { id: 'p1', status: STATES.BUILDING };
  item = applyResult(item, ACTIONS.IMPLEMENT, { agent: { ok: true, commits: [] }, pr: 1 });
  assert.equal(item.cost, undefined);
});

test('costTotals sums across items', () => {
  const reg = createEmptyRegistry();
  reg.items.push(
    { id: 'p1', title: 'a', status: STATES.MERGED, cost: { calls: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    { id: 'p2', title: 'b', status: STATES.MERGED, cost: { calls: 2, promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
    { id: 'p3', title: 'c', status: STATES.PLANNED },
  );
  assert.deepEqual(costTotals(reg), { calls: 3, promptTokens: 30, completionTokens: 15, totalTokens: 45 });
});

test('formatStatus shows waves, ready/blocked catch-up, and cost', () => {
  const reg = createEmptyRegistry();
  reg.items.push(
    { id: 'p1', title: 'Done thing', status: STATES.MERGED, wave: 'wave1', implementer: 'deepseek', reviewer: 'qwen', pr: 1, cost: { calls: 3, promptTokens: 100, completionTokens: 40, totalTokens: 140 } },
    { id: 'p2', title: 'Ready thing', status: STATES.READY_FOR_HUMAN_MERGE, wave: 'wave1', implementer: 'deepseek', reviewer: 'qwen', pr: 2 },
    { id: 'p3', title: 'Stuck thing', status: STATES.BLOCKED, wave: 'wave1', blockedOn: 'need a product decision on X' },
  );
  reg.notes.push({ at: 't', kind: 'info', text: 'a note' });

  const s = formatStatus(reg);
  assert.match(s, /wave1: 1\/3 merged/);
  assert.match(s, /READY to merge \(1\):/);
  assert.match(s, /p2 Ready thing \(PR #2\)/);
  assert.match(s, /BLOCKED — needs a decision \(1\):/);
  assert.match(s, /need a product decision on X/);
  assert.match(s, /140 tokens/);
  assert.match(s, /\[info\] a note/);
});
