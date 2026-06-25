// Phase 4 — concurrency + WIP cap. Offline (mock adapters + mock services).
// Seeds several items and asserts they all finish while never exceeding the
// configured work-in-progress cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry } from '../src/registry/store.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { seedItems } from '../src/planner.mjs';
import { STATES, ACTIVE } from '../src/state-machine.mjs';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-conc-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const now = () => '2026-06-25T12:00:00Z';

function buildOrch(path, concurrency) {
  const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
  reg.policy.merge = 'auto';
  reg.policy.concurrency = concurrency;
  seedItems(reg, ['Task A', 'Task B', 'Task C', 'Task D', 'Task E'], { wave: 'wave1' });
  saveRegistry(path, reg);

  const adapters = {
    deepseek: createMockAdapter({ vendor: 'deepseek' }),
    qwen: createMockAdapter({ vendor: 'qwen' }), // default verdict CLEAN
  };
  return createOrchestrator({
    store: createFileStore(), registryPath: path,
    adapters, services: createMockServices(), now,
  });
}

test('all five items reach MERGED under auto-merge', () =>
  withTmp(async (path) => {
    const orch = buildOrch(path, 2);
    const final = await orch.run();
    assert.equal(final.items.length, 5);
    assert.ok(final.items.every((i) => i.status === STATES.MERGED), 'all merged');
    // cross-vendor roles assigned
    assert.ok(final.items.every((i) => i.implementer === 'deepseek' && i.reviewer === 'qwen'));
  }));

test('WIP never exceeds the concurrency cap', () =>
  withTmp(async (path) => {
    const cap = 2;
    const orch = buildOrch(path, cap);
    let maxActive = 0;
    await orch.run({
      onTick: (reg) => {
        const active = reg.items.filter((i) => ACTIVE.includes(i.status)).length;
        maxActive = Math.max(maxActive, active);
      },
    });
    assert.ok(maxActive <= cap, `max active ${maxActive} should not exceed cap ${cap}`);
    assert.ok(maxActive > 0, 'work actually happened');
  }));

test('a higher cap lets more items run at once', () =>
  withTmp(async (path) => {
    const cap = 5;
    const orch = buildOrch(path, cap);
    let maxActive = 0;
    await orch.run({
      onTick: (reg) => {
        const active = reg.items.filter((i) => ACTIVE.includes(i.status)).length;
        maxActive = Math.max(maxActive, active);
      },
    });
    // with cap 5 and 5 items, more than 2 should be active at some point
    assert.ok(maxActive >= 3, `expected concurrency, saw max active ${maxActive}`);
  }));
