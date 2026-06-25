// ② CLI-harness adapter — drives an installed agent CLI. Offline: a fake runner
// for the logic, and a real fake CLI (a node script) spawned via the default
// runner to prove spawn + stdin + parse + commit end to end. No real claude/codex.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHarnessAdapter, HARNESS_PRESETS } from '../src/adapters/harness.mjs';
import { createRealAdapters } from '../src/adapters/factory.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function makeWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'polly-harness-'));
  const work = join(root, 'work');
  execFileSync('git', ['init', work]);
  git(work, 'config', 'user.email', 'polly@test.local');
  git(work, 'config', 'user.name', 'Polly Test');
  git(work, 'checkout', '-b', 'main');
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-m', 'init']);
  const wtRel = '.worktrees/p1-x';
  execFileSync('git', ['-C', work, 'worktree', 'add', '-b', 'polly/p1-x', join(work, wtRel), 'main']);
  return { root, work, worktreePath: wtRel };
}

const claudeJson = (over = {}) => JSON.stringify({
  result: 'Created file', session_id: 'sess-123', total_cost_usd: 0.002,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});

test('implement: CLI edits the worktree, Polly commits, usage + session parsed', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    // fake runner simulates the CLI editing a file, then prints claude JSON
    const runner = async ({ cwd }) => {
      writeFileSync(join(cwd, 'feature.txt'), 'made by the harness\n');
      return { code: 0, stdout: claudeJson(), stderr: '' };
    };
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, runner });
    const res = await adapter.implement({ itemId: 'p1', spec: 'create feature.txt', worktreePath });

    assert.equal(res.ok, true);
    assert.equal(res.convId, 'sess-123', 'returns the CLI session id (for ⑤ native resume)');
    assert.equal(res.usage.totalTokens, 120);
    assert.equal(res.commits.length, 1);
    assert.match(git(join(work, worktreePath), 'log', '--oneline'), /Created file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('implement: no file change → ok:false (nothing to commit)', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const runner = async () => ({ code: 0, stdout: claudeJson(), stderr: '' }); // edits nothing
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, runner });
    const res = await adapter.implement({ itemId: 'p1', spec: 'noop', worktreePath });
    assert.equal(res.ok, false);
    assert.equal(res.commits.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('implement: a fix lap uses the native --resume <session-id> (⑤)', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const calls = [];
    const runner = async ({ args, cwd }) => {
      calls.push(args);
      writeFileSync(join(cwd, `f${calls.length}.txt`), 'x\n');
      return { code: 0, stdout: claudeJson(), stderr: '' };
    };
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, runner });
    await adapter.implement({ itemId: 'p1', spec: 'build', worktreePath });
    await adapter.implement({ itemId: 'p1', spec: 'fix it', worktreePath, resumeConvId: 'sess-123' });

    assert.ok(calls[0].includes('--session-id'), 'first lap opens a session');
    assert.ok(calls[1].includes('--resume') && calls[1].includes('sess-123'), 'fix lap resumes it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review: parses POLLY_VERDICT / POLLY_FINDING markers', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const runner = async () => ({
      code: 0,
      stdout: claudeJson({ result: 'Looks risky.\nPOLLY_VERDICT: BLOCKING\nPOLLY_FINDING: a.js:1 :: off by one' }),
      stderr: '',
    });
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, runner });
    const res = await adapter.review({ itemId: 'p1', spec: 'do x', worktreePath });
    assert.equal(res.verdict, 'BLOCKING');
    assert.equal(res.findings.length, 1);
    assert.match(res.findings[0].where, /a\.js:1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review: an unparseable reply defaults to BLOCKING (conservative)', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    const runner = async () => ({ code: 0, stdout: claudeJson({ result: 'lgtm' }), stderr: '' });
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, runner });
    const res = await adapter.review({ itemId: 'p1', spec: 'do x', worktreePath });
    assert.equal(res.verdict, 'BLOCKING');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('implement: real spawn via the default runner (fake CLI over stdin)', async () => {
  const { root, work, worktreePath } = makeWorktree();
  try {
    // A real fake CLI: reads stdin, writes a file, prints a claude-style JSON.
    const cli = join(root, 'fakecli.cjs');
    writeFileSync(cli, `
const fs = require('fs');
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  fs.writeFileSync('spawned.txt', 'spec was: ' + input.trim() + '\\n');
  process.stdout.write(JSON.stringify({ result: 'created spawned.txt', session_id: 's1', total_cost_usd: 0, usage: { input_tokens: 5, output_tokens: 2 } }));
});
`);
    const preset = {
      ...HARNESS_PRESETS.claude_code,
      command: process.execPath, // node
      implement: () => ({ args: [cli], viaStdin: true }),
    };
    const adapter = createHarnessAdapter({ vendor: 'claude_code', repoPath: work, preset });
    const res = await adapter.implement({ itemId: 'p1', spec: 'make a file', worktreePath });

    assert.equal(res.ok, true);
    const f = join(work, worktreePath, 'spawned.txt');
    assert.ok(existsSync(f), 'fake CLI wrote the file via the real spawn runner');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('factory builds harness + API adapters, and rejects unknown vendors', () => {
  const map = createRealAdapters({ vendors: ['claude_code', 'deepseek'], repoPath: '/tmp/x' });
  assert.equal(map.claude_code.vendor, 'claude_code');
  assert.equal(map.deepseek.vendor, 'deepseek');
  assert.throws(() => createRealAdapters({ vendors: ['nope'], repoPath: '/tmp/x' }), /unknown vendor/);
});
