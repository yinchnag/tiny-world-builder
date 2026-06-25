// S5 — project memory: injected into prompts; scribe appends on merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileMemory, createInMemoryMemory } from '../src/memory.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from '../src/registry/store.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { seedItems } from '../src/planner.mjs';
import { STATES } from '../src/state-machine.mjs';

const now = () => '2026-06-25T12:00:00Z';

test('file memory round-trips and writes a header on first append', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polly-mem-'));
  try {
    const m = createFileMemory(join(dir, 'memory.md'));
    assert.equal(m.read(), '');
    m.append('- decision: use snake_case');
    assert.ok(existsSync(m.path));
    assert.match(m.read(), /# Project memory/);
    assert.match(m.read(), /snake_case/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withTmpRegistry(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polly-mem-'));
  const path = join(dir, 'registry.json');
  return Promise.resolve(fn(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('memory is injected into the implementer spec', () =>
  withTmpRegistry(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, [{ id: 'x', title: 'X', spec: 'build the X feature' }]);
    saveRegistry(path, reg);

    const seenSpecs = [];
    const recording = { vendor: 'deepseek', async implement(t) { seenSpecs.push(t.spec); return { ok: true, commits: ['c'] }; } };
    const memory = createInMemoryMemory('- Use TypeScript everywhere.\n- API errors return JSON.');

    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: recording, qwen: createMockAdapter({ vendor: 'qwen' }) },
      services: createMockServices(), now, memory,
    });
    await orch.run();

    assert.match(seenSpecs[0], /PROJECT MEMORY/);
    assert.match(seenSpecs[0], /Use TypeScript everywhere/);
    assert.match(seenSpecs[0], /build the X feature/); // the actual task is still there
  }));

test('no memory → spec is unchanged', () =>
  withTmpRegistry(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, [{ id: 'x', title: 'X', spec: 'plain task' }]);
    saveRegistry(path, reg);

    const seen = [];
    const recording = { vendor: 'deepseek', async implement(t) { seen.push(t.spec); return { ok: true, commits: ['c'] }; } };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: recording, qwen: createMockAdapter({ vendor: 'qwen' }) },
      services: createMockServices(), now, memory: createInMemoryMemory(''),
    });
    await orch.run();
    assert.equal(seen[0], 'plain task');
  }));

test('scribe appends a record to memory when an item merges', () =>
  withTmpRegistry(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    reg.policy.scribe = true;
    seedItems(reg, [{ id: 'auth', title: 'Add auth', spec: 'jwt' }]);
    saveRegistry(path, reg);

    const memory = createInMemoryMemory('');
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: createMockAdapter({ vendor: 'deepseek' }), qwen: createMockAdapter({ vendor: 'qwen' }) },
      services: createMockServices(), now, memory,
    });
    await orch.run();

    assert.equal(loadRegistry(path).items[0].status, STATES.MERGED);
    assert.match(memory.read(), /\[auth\] Add auth/);
  }));

test('without policy.scribe, memory is not appended on merge', () =>
  withTmpRegistry(async (path) => {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, [{ id: 'auth', title: 'Add auth', spec: 'jwt' }]);
    saveRegistry(path, reg);
    const memory = createInMemoryMemory('');
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: createMockAdapter({ vendor: 'deepseek' }), qwen: createMockAdapter({ vendor: 'qwen' }) },
      services: createMockServices(), now, memory,
    });
    await orch.run();
    assert.equal(memory.read(), '');
  }));
