// Phase 3 integration test — the orchestrator driving REAL git end to end,
// fully offline (no LLM, no GitHub). The implementer is a tiny inline adapter
// that writes + commits a real file; the reviewer is a mock. This proves the
// orchestrator + real git services + merge gate work together and actually land
// a change on `main`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry } from '../src/registry/store.mjs';
import { createGitServices, localMergeStrategy } from '../src/services/git.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { STATES } from '../src/state-machine.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'polly-e2e-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', bare]);
  execFileSync('git', ['clone', bare, work]);
  git(work, 'config', 'user.email', 'polly@test.local');
  git(work, 'config', 'user.name', 'Polly Test');
  git(work, 'checkout', '-b', 'main');
  writeFileSync(join(work, 'README.md'), 'init\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'init');
  git(work, 'push', '-u', 'origin', 'main');
  return { root, work };
}

// A stand-in implementer that really writes + commits a file in the worktree
// (mimicking what the DeepSeek adapter does), so the merge has real content.
function fileWritingImplementer(work) {
  return {
    vendor: 'deepseek',
    async implement(task) {
      const abs = join(work, task.worktreePath);
      writeFileSync(join(abs, 'feature.txt'), 'real content from the implementer\n');
      git(abs, 'add', '-A');
      git(abs, 'commit', '-m', 'add feature.txt');
      return { ok: true, convId: 'c1', summary: 'added feature.txt', commits: [git(abs, 'rev-parse', '--short', 'HEAD')] };
    },
  };
}

test('orchestrator + real git + auto-merge lands a real change on main', async () => {
  const { root, work } = makeRepo();
  try {
    const registryPath = join(work, '.polly-registry.json');
    const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
    reg.policy.merge = 'auto';
    reg.items.push({
      id: 'p1', wave: null, title: 'Add feature', spec: 'Add feature.txt',
      branch: null, worktree: null, base: null, pr: null,
      implementer: null, reviewer: null, convId: null, reviewConvId: null,
      status: STATES.PLANNED, reviewRound: 0,
      createdAt: '2026-06-25T00:00:00Z', mergedAt: null, review: null, gates: null, caveats: [],
    });
    saveRegistry(registryPath, reg);

    const services = createGitServices({
      repoPath: work, remote: 'origin', baseRef: 'main',
      gatesCommand: 'node -e "process.exit(0)"',
      createPullRequest: () => 7,            // offline PR stub
      mergePullRequest: localMergeStrategy,  // offline local merge
    });
    const adapters = {
      deepseek: fileWritingImplementer(work),
      qwen: createMockAdapter({ vendor: 'qwen', reviewPlan: { p1: ['CLEAN'] } }),
    };
    const orch = createOrchestrator({
      store: createFileStore(), registryPath, adapters, services,
      now: () => '2026-06-25T12:00:00Z',
    });

    await orch.run();

    const item = createFileStore().load(registryPath).items[0];
    assert.equal(item.status, STATES.MERGED);
    assert.equal(item.implementer, 'deepseek');
    assert.equal(item.reviewer, 'qwen'); // cross-vendor, different family
    assert.equal(item.worktree, null, 'worktree torn down on merge');

    // The change really landed on main.
    assert.match(git(work, 'ls-tree', '-r', '--name-only', 'main'), /feature\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
