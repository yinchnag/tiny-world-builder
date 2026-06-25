// ④ The daemon — keeps ticking, drains work, picks up items added mid-run, and
// stops cleanly. Offline (mock adapters + services).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from '../src/registry/store.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { createDaemon } from '../src/daemon.mjs';
import { seedItems } from '../src/planner.mjs';
import { STATES } from '../src/state-machine.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred, { timeout = 3000, step = 5 } = {}) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timed out');
    await sleep(step);
  }
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-daemon-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function makeOrch(path) {
  return createOrchestrator({
    store: createFileStore(),
    registryPath: path,
    adapters: { deepseek: createMockAdapter({ vendor: 'deepseek' }), qwen: createMockAdapter({ vendor: 'qwen' }) },
    services: createMockServices(),
    now: () => '2026-06-25T12:00:00Z',
  });
}

const merged = (path) => loadRegistry(path).items.every((i) => i.status === STATES.MERGED);

test('daemon drains existing work to MERGED, then stops cleanly', () =>
  withTmp(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, ['A', 'B', 'C']);
    saveRegistry(path, reg);

    const daemon = createDaemon({ orchestrator: makeOrch(path), intervalMs: 10 });
    const running = daemon.start();
    await waitUntil(() => loadRegistry(path).items.length === 3 && merged(path));
    daemon.stop();
    await running; // resolves cleanly
    assert.ok(daemon.stopped);
    assert.ok(merged(path));
  }));

test('daemon picks up items added to the registry mid-run', () =>
  withTmp(async (path) => {
    // start idle (no items)
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    saveRegistry(path, reg);

    const daemon = createDaemon({ orchestrator: makeOrch(path), intervalMs: 10 });
    const running = daemon.start();
    await sleep(25); // let it idle-poll a couple of times

    // add work externally (as `polly add` would)
    const live = loadRegistry(path);
    seedItems(live, ['late task']);
    saveRegistry(path, live);

    await waitUntil(() => loadRegistry(path).items.length === 1 && merged(path));
    daemon.stop();
    await running;
    assert.equal(loadRegistry(path).items[0].status, STATES.MERGED);
  }));

test('a throwing tick does not kill the daemon', async () => {
  let calls = 0;
  const errors = [];
  const flaky = {
    tick: async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return false; // idle afterwards
    },
  };
  const daemon = createDaemon({ orchestrator: flaky, intervalMs: 5, onError: (e) => errors.push(e.message) });
  const running = daemon.start();
  await waitUntil(() => calls >= 2);
  daemon.stop();
  await running;
  assert.deepEqual(errors, ['boom']);
  assert.ok(calls >= 2, 'kept ticking after the error');
});
