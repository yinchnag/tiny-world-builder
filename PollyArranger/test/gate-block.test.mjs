// ① Red gate blocks the PR. Offline: mock adapters + mock services with a gates
// stub we control. Asserts a failing gate never opens a PR and routes the item
// back through FIXING, then escalates to BLOCKED — and that a gate which goes
// green lets the item proceed to review.

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
import { STATES } from '../src/state-machine.mjs';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-gate-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const now = () => '2026-06-25T12:00:00Z';

// Services with a controllable gate result and an openPR call counter.
function gateServices(gateResults) {
  const services = createMockServices();
  let i = 0;
  services.gates = { run: () => gateResults[Math.min(i++, gateResults.length - 1)] };
  let prCalls = 0;
  const open = services.git.openPR;
  services.git.openPR = (a) => { prCalls += 1; return open(a); };
  return { services, prCalls: () => prCalls };
}

function build(path, services) {
  const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
  reg.policy.merge = 'auto';
  reg.policy.maxGateRounds = 3;
  seedItems(reg, ['Task A'], { wave: 'wave1' });
  saveRegistry(path, reg);
  const adapters = {
    deepseek: createMockAdapter({ vendor: 'deepseek' }),
    qwen: createMockAdapter({ vendor: 'qwen' }), // CLEAN
  };
  return createOrchestrator({ store: createFileStore(), registryPath: path, adapters, services, now });
}

test('a persistently red gate never opens a PR and ends BLOCKED', () =>
  withTmp(async (path) => {
    const { services, prCalls } = gateServices([{ command: 'npm test', passed: false, output: '1 failing' }]);
    const orch = build(path, services);
    const final = await orch.run();
    const item = final.items[0];
    assert.equal(item.status, STATES.BLOCKED);
    assert.match(item.blockedOn, /[Gg]ates still failing/);
    assert.equal(prCalls(), 0, 'no PR should be opened while gates are red');
    assert.equal(item.pr, null);
    assert.equal(item.gateRound, 3);
  }));

test('a gate that goes green lets the item proceed to review and merge', () =>
  withTmp(async (path) => {
    // red once, then green forever
    const { services, prCalls } = gateServices([
      { command: 'npm test', passed: false, output: 'boom' },
      { command: 'npm test', passed: true },
    ]);
    const orch = build(path, services);
    const final = await orch.run();
    const item = final.items[0];
    assert.equal(item.status, STATES.MERGED);
    assert.ok(item.pr != null, 'PR opened once gates went green');
    assert.equal(prCalls(), 1, 'PR opened exactly once');
  }));

test('the implementer is handed the gate failure output on the fix lap', () =>
  withTmp(async (path) => {
    // Capture the spec the implementer receives on its second call.
    const specs = [];
    const recordingImplementer = {
      vendor: 'deepseek',
      async implement(task) { specs.push(task.spec); return { ok: true, convId: 'c', commits: ['m'] }; },
    };
    const { services } = gateServices([
      { command: 'npm test', passed: false, output: 'AssertionError: expected 1 to equal 2' },
      { command: 'npm test', passed: true },
    ]);
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, ['Task A'], { wave: 'wave1' });
    saveRegistry(path, reg);
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: recordingImplementer, qwen: createMockAdapter({ vendor: 'qwen' }) },
      services, now,
    });
    await orch.run();
    assert.ok(specs.length >= 2, 'implementer ran at least twice');
    assert.match(specs[1], /AssertionError: expected 1 to equal 2/, 'fix lap spec includes the gate output');
  }));
