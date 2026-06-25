// S3 — capability/cost routing + auto-escalation. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { routeRoles, applyResult, ACTIONS, STATES } from '../src/state-machine.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from '../src/registry/store.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { seedItems } from '../src/planner.mjs';

const VENDORS = ['deepseek', 'qwen', 'claude_code'];

// ---- routeRoles ------------------------------------------------------------

test('routeRoles with no routing = assignRoles default', () => {
  const r = routeRoles({ tags: [] }, VENDORS, {});
  assert.equal(r.implementer, 'deepseek');
  assert.notEqual(r.reviewer, 'deepseek');
});

test('routeRoles honors default + a per-tag override', () => {
  const routing = {
    default: { implementer: 'deepseek', reviewer: 'qwen' },
    rules: [{ tag: 'hard', implementer: 'claude_code' }],
  };
  assert.deepEqual(routeRoles({ tags: [] }, VENDORS, { routing }), { implementer: 'deepseek', reviewer: 'qwen' });
  const hard = routeRoles({ tags: ['hard'] }, VENDORS, { routing });
  assert.equal(hard.implementer, 'claude_code');
  assert.notEqual(hard.reviewer, 'claude_code'); // kept distinct
});

test('routeRoles ignores vendors outside the pool and keeps roles distinct', () => {
  const routing = { default: { implementer: 'ghost', reviewer: 'deepseek' }, rules: [] };
  const r = routeRoles({ tags: [] }, VENDORS, { routing });
  assert.ok(VENDORS.includes(r.implementer));
  assert.notEqual(r.implementer, r.reviewer);
});

// ---- auto-escalation -------------------------------------------------------

test('auto-escalate switches implementer once at the review cap, then BLOCKED', () => {
  const policy = { maxReviewRounds: 2, autoEscalate: true, routing: { escalateTo: 'claude_code' } };
  // an item at the cap, BLOCKING again, cheap implementer
  let item = { id: 'p1', status: STATES.RE_REVIEW, reviewRound: 1, implementer: 'deepseek', reviewer: 'qwen' };
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING', findings: [] } }, { policy });
  assert.equal(item.status, STATES.FIXING, 'escalated → another fix lap');
  assert.equal(item.implementer, 'claude_code', 'switched to the stronger vendor');
  assert.equal(item.escalated, true);
  assert.equal(item.reviewRound, 0, 'fresh round budget');

  // now it still cannot pass → after the cap again, no second escalation → BLOCKED
  item.reviewRound = 1;
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING', findings: [] } }, { policy });
  assert.equal(item.status, STATES.BLOCKED);
  assert.match(item.blockedOn, /already escalated to claude_code/);
});

test('without autoEscalate, the cap goes straight to BLOCKED', () => {
  const policy = { maxReviewRounds: 1, routing: { escalateTo: 'claude_code' } }; // autoEscalate off
  let item = { id: 'p1', status: STATES.IN_REVIEW, reviewRound: 0, implementer: 'deepseek', reviewer: 'qwen' };
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING', findings: [] } }, { policy });
  assert.equal(item.status, STATES.BLOCKED);
});

test('advisory review never blocks — a BLOCKING verdict still parks for the human', () => {
  const policy = { review: 'advisory', maxReviewRounds: 1 };
  let item = { id: 'p1', status: STATES.IN_REVIEW, reviewRound: 0, implementer: 'deepseek', reviewer: 'qwen' };
  item = applyResult(item, ACTIONS.REVIEW, { review: { verdict: 'BLOCKING', findings: [{ severity: 'blocking', where: 'x', what: 'y' }] } }, { policy });
  assert.equal(item.status, STATES.READY_FOR_HUMAN_MERGE);
  assert.equal(item.review.verdict, 'BLOCKING'); // findings still recorded
});

// ---- orchestrator integration ----------------------------------------------

test('a tagged item is implemented by the routed vendor', () =>
  (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'polly-route-'));
    const path = join(dir, 'registry.json');
    try {
      const reg = createEmptyRegistry({ vendors: VENDORS });
      reg.policy.merge = 'auto';
      reg.policy.routing = {
        default: { implementer: 'deepseek', reviewer: 'qwen' },
        rules: [{ tag: 'hard', implementer: 'claude_code' }],
      };
      seedItems(reg, [
        { id: 'easy', title: 'easy', spec: 'x' },
        { id: 'tough', title: 'tough', spec: 'y', tags: ['hard'] },
      ]);
      saveRegistry(path, reg);

      const orch = createOrchestrator({
        store: createFileStore(), registryPath: path,
        adapters: {
          deepseek: createMockAdapter({ vendor: 'deepseek' }),
          qwen: createMockAdapter({ vendor: 'qwen' }),
          claude_code: createMockAdapter({ vendor: 'claude_code' }),
        },
        services: createMockServices(), now: () => '2026-06-25T12:00:00Z',
      });
      await orch.run();

      const items = loadRegistry(path).items;
      assert.equal(items.find((i) => i.id === 'easy').implementer, 'deepseek');
      assert.equal(items.find((i) => i.id === 'tough').implementer, 'claude_code');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());
