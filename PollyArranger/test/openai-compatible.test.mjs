// Tests for the OpenAI-compatible adapter (Phase 2.2).
//
// No network: a FAKE fetch returns scripted model responses, so we test the
// full tool-calling loop deterministically. The worktree + commit are real (a
// throwaway git repo), so we verify the adapter actually edits files and commits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpenAICompatibleAdapter } from '../src/adapters/openai-compatible.mjs';
import { createGitServices } from '../src/services/git.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function makeWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'polly-ai-'));
  const work = join(root, 'work');
  execFileSync('git', ['init', work]);
  git(work, 'config', 'user.email', 'polly@test.local');
  git(work, 'config', 'user.name', 'Polly Test');
  git(work, 'checkout', '-b', 'main');
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-m', 'init']);
  const svc = createGitServices({ repoPath: work, baseRef: 'main' });
  const item = { id: 'p1', title: 'Demo task', branch: null, worktree: null };
  const loc = svc.worktree.create({ item });
  return { root, work, worktreePath: loc.worktree };
}

// Build a fake fetch that returns a queue of assistant messages as OpenAI JSON.
function fakeFetch(messageQueue) {
  let i = 0;
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: messageQueue[i++] }] }),
    text: async () => '',
  });
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('implement runs the tool loop, writes a file, and commits', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const fetchImpl = fakeFetch([
      // step 1: the model writes a file
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'write_file', { path: 'hello.txt', content: 'hi from the agent\n' })] },
      // step 2: the model finishes
      { role: 'assistant', content: null, tool_calls: [toolCall('c2', 'finish', { summary: 'created hello.txt' })] },
    ]);

    const adapter = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'test-key', fetchImpl,
    });

    const res = await adapter.implement({ itemId: 'p1', spec: 'Create hello.txt', worktreePath });

    assert.equal(res.ok, true);
    assert.equal(res.commits.length, 1);
    const absFile = join(work, worktreePath, 'hello.txt');
    assert.ok(existsSync(absFile), 'file should exist');
    assert.match(readFileSync(absFile, 'utf8'), /hi from the agent/);
    // it was actually committed
    assert.match(git(join(work, worktreePath), 'log', '--oneline'), /created hello\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('implement returns ok:false when the model changes nothing', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const fetchImpl = fakeFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'finish', { summary: 'nothing to do' })] },
    ]);
    const adapter = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'test-key', fetchImpl,
    });
    const res = await adapter.implement({ itemId: 'p1', spec: 'noop', worktreePath });
    assert.equal(res.ok, false);
    assert.equal(res.commits.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('write_file refuses to escape the worktree', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const fetchImpl = fakeFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'write_file', { path: '../../escape.txt', content: 'x' })] },
      { role: 'assistant', content: null, tool_calls: [toolCall('c2', 'finish', { summary: 'tried to escape' })] },
    ]);
    const adapter = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'test-key', fetchImpl,
    });
    const res = await adapter.implement({ itemId: 'p1', spec: 'escape', worktreePath });
    // nothing legal was written -> no commit
    assert.equal(res.ok, false);
    assert.ok(!existsSync(join(root, 'escape.txt')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review returns a structured verdict from a submit_review tool call', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const fetchImpl = fakeFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'submit_review', {
        verdict: 'BLOCKING',
        findings: [{ severity: 'blocking', where: 'a.js:1', what: 'off by one' }],
      })] },
    ]);
    const adapter = createOpenAICompatibleAdapter({
      provider: 'openai', repoPath: work, apiKey: 'test-key', fetchImpl,
    });
    const res = await adapter.review({ itemId: 'p1', spec: 'do x', worktreePath });
    assert.equal(res.verdict, 'BLOCKING');
    assert.equal(res.findings.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
