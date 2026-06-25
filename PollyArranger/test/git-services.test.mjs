// Tests for the REAL git services (Phase 2.1).
//
// These run against a THROWAWAY local repo + a local bare "remote" — no GitHub,
// no network. PR creation is injected as a stub so we still exercise the real
// push; the `gh`-based default is live-only and not unit-tested here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitServices } from '../src/services/git.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

// Build a temp repo cloned from a bare remote, with one commit on `main`.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'polly-git-'));
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
  return { root, bare, work };
}

test('worktree.create makes a branch + isolated checkout off the base', async () => {
  const { root, work } = makeRepo();
  try {
    const svc = createGitServices({ repoPath: work, remote: 'origin', baseRef: 'main' });
    const item = { id: 'p1', title: 'Demo thing', branch: null, worktree: null };
    const loc = await svc.worktree.create({ item });

    assert.equal(loc.branch, 'polly/p1-demo-thing');
    assert.match(loc.base, /^main [0-9a-f]+$/);
    assert.ok(existsSync(join(work, loc.worktree)), 'worktree dir should exist on disk');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('commit + openPR pushes the branch to the remote and returns the PR number', async () => {
  const { root, work } = makeRepo();
  try {
    const svc = createGitServices({
      repoPath: work, remote: 'origin', baseRef: 'main',
      createPullRequest: () => 7, // stub — exercises the real push, fakes the PR
    });
    const item = { id: 'p1', title: 'Demo thing', branch: null, worktree: null };
    const loc = await svc.worktree.create({ item });
    item.branch = loc.branch;
    item.worktree = loc.worktree;

    // The implementer would do this; here we do it by hand.
    writeFileSync(join(work, loc.worktree, 'feature.txt'), 'hello\n');
    const sha = await svc.git.commit({ item, message: 'add feature' });
    assert.ok(sha.length > 0, 'commit returns a sha');

    const pr = await svc.git.openPR({ item });
    assert.equal(pr, 7);

    // The branch must now exist in the remote. Query it via ls-remote from the
    // work repo (avoids `git -C <bare>`, which safe.bareRepository can block).
    const remoteRefs = git(work, 'ls-remote', '--heads', 'origin', loc.branch);
    assert.match(remoteRefs, /refs\/heads\/polly\/p1-demo-thing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gates capture pass/fail without throwing', async () => {
  const { root, work } = makeRepo();
  try {
    const item = { id: 'p1', title: 'Demo thing', branch: null, worktree: null };
    await createGitServices({ repoPath: work, baseRef: 'main' }).worktree.create({ item });
    item.branch = 'polly/p1-demo-thing';
    item.worktree = '.worktrees/p1-demo-thing';

    const pass = await createGitServices({
      repoPath: work, gatesCommand: 'node -e "process.exit(0)"',
    }).gates.run({ item });
    assert.equal(pass.passed, true);

    const fail = await createGitServices({
      repoPath: work, gatesCommand: 'node -e "process.exit(1)"',
    }).gates.run({ item });
    assert.equal(fail.passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('teardown removes the worktree', async () => {
  const { root, work } = makeRepo();
  try {
    const svc = createGitServices({ repoPath: work, baseRef: 'main' });
    const item = { id: 'p1', title: 'Demo thing', branch: null, worktree: null };
    const loc = await svc.worktree.create({ item });
    item.worktree = loc.worktree;
    assert.ok(existsSync(join(work, loc.worktree)));

    await svc.worktree.teardown({ item });
    assert.ok(!existsSync(join(work, loc.worktree)), 'worktree dir should be gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
