// S2 — merge-conflict handling. A conflicting merge routes the item to BLOCKED
// (keeping its worktree) instead of crashing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyResult, ACTIONS, STATES } from '../src/state-machine.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from '../src/registry/store.mjs';
import { createGitServices, localMergeStrategy } from '../src/services/git.mjs';
import { createMockServices } from '../src/services/mock.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { seedItems } from '../src/planner.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}
const now = () => '2026-06-25T12:00:00Z';

// ---- pure: applyResult routes a conflict to BLOCKED ------------------------

test('applyResult MERGE with a conflict → BLOCKED (worktree kept)', () => {
  const item = { id: 'p1', status: STATES.READY_FOR_HUMAN_MERGE, worktree: '.worktrees/p1', base: 'main abc' };
  const out = applyResult(item, ACTIONS.MERGE, { mergeConflict: { ok: false, conflicts: ['app.js'] } }, { now });
  assert.equal(out.status, STATES.BLOCKED);
  assert.match(out.blockedOn, /Merge conflict.*app\.js/);
  assert.equal(out.worktree, '.worktrees/p1', 'worktree not torn down on conflict');
});

test('applyResult MERGE clean → MERGED', () => {
  const item = { id: 'p1', status: STATES.READY_FOR_HUMAN_MERGE, worktree: '.worktrees/p1' };
  const out = applyResult(item, ACTIONS.MERGE, { mergedAt: now() }, { now });
  assert.equal(out.status, STATES.MERGED);
  assert.equal(out.worktree, null);
});

// ---- mock integration: simulated conflict → BLOCKED ------------------------

test('orchestrator: a conflicting merge blocks the item (mock services)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polly-mc-'));
  const path = join(dir, 'registry.json');
  try {
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    seedItems(reg, ['solo']);
    saveRegistry(path, reg);

    const services = createMockServices();
    services.git.merge = () => ({ ok: false, conflicts: ['x.js'], reason: 'add/add' }); // simulate conflict
    const orch = createOrchestrator({
      store: createFileStore(), registryPath: path,
      adapters: { deepseek: createMockAdapter({ vendor: 'deepseek' }), qwen: createMockAdapter({ vendor: 'qwen' }) },
      services, now,
    });
    await orch.run();
    const it = loadRegistry(path).items[0];
    assert.equal(it.status, STATES.BLOCKED);
    assert.match(it.blockedOn, /Merge conflict.*x\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- real git: two concurrent branches edit the same file ------------------

test('orchestrator + real git: second of two conflicting merges → BLOCKED', async () => {
  const root = mkdtempSync(join(tmpdir(), 'polly-mc-real-'));
  const work = join(root, 'work');
  try {
    execFileSync('git', ['init', work]);
    git(work, 'config', 'user.email', 'polly@test.local');
    git(work, 'config', 'user.name', 'Polly Test');
    git(work, 'checkout', '-b', 'main');
    git(work, 'commit', '--allow-empty', '-m', 'init');

    const registryPath = join(work, '.polly-registry.json');
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    reg.policy.concurrency = 2; // both start before either merges → real conflict
    seedItems(reg, [{ id: 'a', title: 'A', spec: 'x' }, { id: 'b', title: 'B', spec: 'y' }]);
    saveRegistry(registryPath, reg);

    // Both items create the SAME file with different content → add/add conflict.
    const conflicting = {
      vendor: 'deepseek',
      async implement(task) {
        const abs = join(work, task.worktree ?? `.worktrees/${task.itemId}-${task.itemId}`);
        // resolve worktree from the registry-built path
        const wt = join(work, loadRegistry(registryPath).items.find((i) => i.id === task.itemId).worktree);
        writeFileSync(join(wt, 'shared.txt'), `content from ${task.itemId}\n`);
        git(wt, 'add', '-A');
        git(wt, 'commit', '-m', `edit by ${task.itemId}`);
        return { ok: true, convId: 'c', commits: [git(wt, 'rev-parse', '--short', 'HEAD')] };
      },
    };
    const services = createGitServices({
      repoPath: work, baseRef: 'main', gatesCommand: 'node -e "process.exit(0)"',
      createPullRequest: () => 1, mergePullRequest: localMergeStrategy, noPush: true,
    });
    const orch = createOrchestrator({
      store: createFileStore(), registryPath,
      adapters: { deepseek: conflicting, qwen: createMockAdapter({ vendor: 'qwen', reviewPlan: { '*': ['CLEAN'] } }) },
      services, now,
    });
    await orch.run();

    const items = loadRegistry(registryPath).items;
    const merged = items.filter((i) => i.status === STATES.MERGED);
    const blocked = items.filter((i) => i.status === STATES.BLOCKED);
    assert.equal(merged.length, 1, 'exactly one merged');
    assert.equal(blocked.length, 1, 'the other hit a conflict and is BLOCKED');
    assert.match(blocked[0].blockedOn, /Merge conflict/);
    // base stayed clean (the winner's content), conflict was aborted
    assert.match(git(work, 'show', 'main:shared.txt'), /content from (a|b)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
