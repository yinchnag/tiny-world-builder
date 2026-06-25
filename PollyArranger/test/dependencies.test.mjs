// S1 — task dependencies + merge ordering. Offline (mock adapters + services).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { depGate, STATES } from '../src/state-machine.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from '../src/registry/store.mjs';
import { seedItems, detectCycle, validateDependencies } from '../src/planner.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';

// ---- pure depGate ----------------------------------------------------------

test('depGate: no deps → ready', () => {
  assert.equal(depGate({ dependsOn: [] }, {}).state, 'ready');
});
test('depGate: all deps merged → ready; some unmerged → waiting', () => {
  assert.equal(depGate({ dependsOn: ['a'] }, { a: STATES.MERGED }).state, 'ready');
  assert.equal(depGate({ dependsOn: ['a', 'b'] }, { a: STATES.MERGED, b: STATES.BUILDING }).state, 'waiting');
});
test('depGate: a BLOCKED dep → waiting (a human might resolve it)', () => {
  assert.equal(depGate({ dependsOn: ['a'] }, { a: STATES.BLOCKED }).state, 'waiting');
});
test('depGate: an ABANDONED or missing dep → failed', () => {
  assert.equal(depGate({ dependsOn: ['a'] }, { a: STATES.ABANDONED }).state, 'failed');
  assert.equal(depGate({ dependsOn: ['a'] }, {}).state, 'failed');
});

// ---- seed-time validation --------------------------------------------------

test('seedItems supports explicit ids + dependsOn', () => {
  const reg = createEmptyRegistry();
  seedItems(reg, [
    { id: 'schema', title: 'DB schema', spec: '...' },
    { id: 'api', title: 'API', spec: '...', dependsOn: ['schema'] },
  ]);
  assert.deepEqual(reg.items.map((i) => i.id), ['schema', 'api']);
  assert.deepEqual(reg.items[1].dependsOn, ['schema']);
});

test('seedItems rejects an unknown dependency and a cycle', () => {
  const reg1 = createEmptyRegistry();
  assert.throws(() => seedItems(reg1, [{ id: 'a', title: 'A', dependsOn: ['ghost'] }]), /unknown item "ghost"/);

  const reg2 = createEmptyRegistry();
  assert.throws(() => seedItems(reg2, [
    { id: 'a', title: 'A', dependsOn: ['b'] },
    { id: 'b', title: 'B', dependsOn: ['a'] },
  ]), /cycle/);
});

test('detectCycle finds a 3-node cycle and passes an acyclic graph', () => {
  assert.ok(detectCycle([
    { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['c'] }, { id: 'c', dependsOn: ['a'] },
  ]));
  assert.equal(detectCycle([
    { id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'] },
  ]), null);
  // validateDependencies is the throwing wrapper
  assert.doesNotThrow(() => validateDependencies([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }]));
});

// ---- orchestrator integration ----------------------------------------------

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-deps-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}
const now = () => '2026-06-25T12:00:00Z';

function orch(path) {
  return createOrchestrator({
    store: createFileStore(), registryPath: path,
    adapters: { deepseek: createMockAdapter({ vendor: 'deepseek' }), qwen: createMockAdapter({ vendor: 'qwen' }) },
    services: createMockServices(), now,
  });
}

test('a dependent does not start until its dependency is MERGED', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, [
      { id: 'a', title: 'first', spec: 'x' },
      { id: 'b', title: 'second', spec: 'y', dependsOn: ['a'] },
    ]);
    saveRegistry(path, reg);

    // Track the order in which items first leave PLANNED.
    const startedOrder = [];
    const seen = new Set();
    await orch(path).run({
      onTick: (r) => {
        for (const it of r.items) {
          if (!seen.has(it.id) && it.status !== STATES.PLANNED) { seen.add(it.id); startedOrder.push(it.id); }
        }
      },
    });

    const final = loadRegistry(path);
    assert.ok(final.items.every((i) => i.status === STATES.MERGED), 'both merge');
    assert.deepEqual(startedOrder, ['a', 'b'], 'b only started after a');
  }));

test('an abandoned dependency cascades the dependent to BLOCKED', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, [
      { id: 'a', title: 'first', spec: 'x' },
      { id: 'b', title: 'second', spec: 'y', dependsOn: ['a'] },
    ]);
    saveRegistry(path, reg);

    // Make the implementer fail on item 'a' so it ABANDONS.
    const failing = { vendor: 'deepseek', async implement() { return { ok: false, commits: [] }; } };
    const o = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: failing, qwen: createMockAdapter({ vendor: 'qwen' }) },
      services: createMockServices(), now,
    });
    await o.run();

    const final = loadRegistry(path);
    const a = final.items.find((i) => i.id === 'a');
    const b = final.items.find((i) => i.id === 'b');
    assert.equal(a.status, STATES.ABANDONED);
    assert.equal(b.status, STATES.BLOCKED);
    assert.match(b.blockedOn, /dependency "a" was abandoned/);
  }));

test('independent items still run in parallel under the cap', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    reg.policy.concurrency = 3;
    seedItems(reg, ['a', 'b', 'c']); // no deps
    saveRegistry(path, reg);
    let maxActive = 0;
    await orch(path).run({
      onTick: (r) => {
        const active = r.items.filter((i) => ['BUILDING', 'IN_REVIEW', 'FIXING', 'RE_REVIEW'].includes(i.status)).length;
        maxActive = Math.max(maxActive, active);
      },
    });
    assert.ok(loadRegistry(path).items.every((i) => i.status === STATES.MERGED));
    assert.ok(maxActive >= 2, 'independent items ran concurrently');
  }));
