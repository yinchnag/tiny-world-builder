// Integration test — the WHOLE pipeline against mocks, no real models or git.
// This is the Phase 1 deliverable from docs/06: drive one item end to end and
// assert it visits every expected state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry } from '../src/registry/store.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { STATES } from '../src/state-machine.mjs';

function seed(path, vendors = ['claude_code', 'codex']) {
  const reg = createEmptyRegistry({ vendors });
  reg.items.push({
    id: 'p1', wave: null, title: 'Demo item', spec: 'Do the thing.',
    branch: null, worktree: null, base: null, pr: null,
    implementer: null, reviewer: null, convId: null, reviewConvId: null,
    status: STATES.PLANNED, reviewRound: 0,
    createdAt: '2026-06-24T00:00:00Z', mergedAt: null,
    review: null, gates: null, caveats: [],
  });
  saveRegistry(path, reg);
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-orch-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const now = () => '2026-06-24T12:00:00Z';

test('item walks PLANNED -> READY through a BLOCKING-then-CLEAN review', () =>
  withTmp(async (path) => {
    seed(path);
    const adapters = {
      claude_code: createMockAdapter({ vendor: 'claude_code' }),
      codex: createMockAdapter({ vendor: 'codex', reviewPlan: { p1: ['BLOCKING', 'CLEAN'] } }),
    };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters, services: createMockServices(), now,
    });

    const visited = [];
    const final = await orch.run({ onTick: (r) => visited.push(r.items[0].status) });

    const it = final.items[0];
    assert.equal(it.status, STATES.READY_FOR_HUMAN_MERGE);
    assert.equal(it.reviewRound, 2, 'one blocking round + one clean round');
    assert.ok(it.pr != null, 'a PR was opened');
    assert.equal(it.implementer, 'claude_code');
    assert.equal(it.reviewer, 'codex'); // cross-vendor

    // It went through the full fix loop.
    for (const s of [
      STATES.BUILDING, STATES.IN_REVIEW, STATES.FIXING,
      STATES.RE_REVIEW, STATES.READY_FOR_HUMAN_MERGE,
    ]) {
      assert.ok(visited.includes(s), `should have visited ${s}; saw ${visited.join(',')}`);
    }
  }));

test('auto-merge policy carries a clean item all the way to MERGED', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['claude_code', 'codex'] });
    reg.policy.merge = 'auto';
    reg.items.push({
      id: 'p1', title: 'Demo', spec: 'x', status: STATES.PLANNED, reviewRound: 0,
      branch: null, worktree: null, base: null, pr: null,
      implementer: null, reviewer: null, review: null, gates: null, caveats: [],
    });
    saveRegistry(path, reg);

    const adapters = {
      claude_code: createMockAdapter({ vendor: 'claude_code' }),
      codex: createMockAdapter({ vendor: 'codex' }), // default: CLEAN
    };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters, services: createMockServices(), now,
    });
    const final = await orch.run();
    assert.equal(final.items[0].status, STATES.MERGED);
    assert.equal(final.items[0].mergedAt, now());
  }));

test('a failing implementer abandons the item instead of looping', () =>
  withTmp(async (path) => {
    seed(path);
    const adapters = {
      claude_code: createMockAdapter({ vendor: 'claude_code', failImplement: true }),
      codex: createMockAdapter({ vendor: 'codex' }),
    };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters, services: createMockServices(), now,
    });
    const final = await orch.run();
    assert.equal(final.items[0].status, STATES.ABANDONED);
  }));

test('a persistently BLOCKING reviewer escalates to BLOCKED at the round cap', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['claude_code', 'codex'] });
    reg.policy.maxReviewRounds = 3;
    reg.items.push({
      id: 'p1', title: 'Demo', spec: 'x', status: STATES.PLANNED, reviewRound: 0,
      branch: null, worktree: null, base: null, pr: null,
      implementer: null, reviewer: null, review: null, gates: null, caveats: [],
    });
    saveRegistry(path, reg);

    const adapters = {
      claude_code: createMockAdapter({ vendor: 'claude_code' }),
      codex: createMockAdapter({ vendor: 'codex', reviewPlan: { '*': ['BLOCKING', 'BLOCKING', 'BLOCKING'] } }),
    };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters, services: createMockServices(), now,
    });
    const final = await orch.run();
    assert.equal(final.items[0].status, STATES.BLOCKED);
    assert.equal(final.items[0].reviewRound, 3);
  }));
