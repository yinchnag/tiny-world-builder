// ⑤ Transcript persistence — store round-trip + the adapter truly resuming.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileTranscriptStore, createMemoryTranscriptStore } from '../src/transcripts.mjs';
import { createOpenAICompatibleAdapter } from '../src/adapters/openai-compatible.mjs';
import { createGitServices } from '../src/services/git.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function makeWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'polly-tx-'));
  const work = join(root, 'work');
  execFileSync('git', ['init', work]);
  git(work, 'config', 'user.email', 'polly@test.local');
  git(work, 'config', 'user.name', 'Polly Test');
  git(work, 'checkout', '-b', 'main');
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-m', 'init']);
  const svc = createGitServices({ repoPath: work, baseRef: 'main' });
  const item = { id: 'p1', title: 'Demo', branch: null, worktree: null };
  const loc = svc.worktree.create({ item });
  return { root, work, worktreePath: loc.worktree };
}

// fake fetch that records each request's messages and replays scripted replies
function recordingFetch(reqMessages, replies) {
  let i = 0;
  return async (_url, options) => {
    reqMessages.push(JSON.parse(options.body).messages);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: replies[i++] }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      text: async () => '',
    };
  };
}

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('file transcript store round-trips messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polly-txs-'));
  try {
    const store = createFileTranscriptStore(dir);
    assert.equal(store.load('conv_x'), null);
    const msgs = [{ role: 'system', content: 'hi' }, { role: 'user', content: 'do x' }];
    store.save('conv_x', msgs);
    assert.ok(existsSync(store.pathFor('conv_x')));
    assert.deepEqual(store.load('conv_x'), msgs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('implement saves a transcript; a resume lap re-sends the prior conversation', async () => {
  const { root, work, worktreePath } = makeWorktree();
  const store = createMemoryTranscriptStore();
  try {
    // --- first lap: writes hello.txt, then finishes ---
    const req1 = [];
    const a1 = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'k', transcriptStore: store,
      fetchImpl: recordingFetch(req1, [
        { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'write_file', { path: 'hello.txt', content: 'hi\n' })] },
        { role: 'assistant', content: null, tool_calls: [toolCall('c2', 'finish', { summary: 'made hello.txt' })] },
      ]),
    });
    const r1 = await a1.implement({ itemId: 'p1', spec: 'Create hello.txt', worktreePath });
    assert.equal(r1.ok, true);
    assert.ok(store.load(r1.convId), 'transcript saved under the build convId');

    // --- fix lap: resume the SAME convId, write world.txt, finish ---
    const req2 = [];
    const a2 = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'k', transcriptStore: store,
      fetchImpl: recordingFetch(req2, [
        { role: 'assistant', content: null, tool_calls: [toolCall('c3', 'write_file', { path: 'world.txt', content: 'world\n' })] },
        { role: 'assistant', content: null, tool_calls: [toolCall('c4', 'finish', { summary: 'made world.txt' })] },
      ]),
    });
    const r2 = await a2.implement({ itemId: 'p1', spec: 'Now also create world.txt', worktreePath, resumeConvId: r1.convId });
    assert.equal(r2.ok, true);
    assert.equal(r2.convId, r1.convId, 'resume keeps the same convId');

    // The first request of the resume lap must carry the prior conversation +
    // the follow-up — not a fresh start.
    const sent = JSON.stringify(req2[0]);
    assert.ok(req2[0].length > 2, 'resume re-sent the accumulated transcript');
    assert.match(sent, /Create hello\.txt/, 'prior spec carried into the resume');
    assert.match(sent, /Now also create world\.txt/, 'follow-up appended');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without resumeConvId the conversation starts fresh', async () => {
  const { root, work, worktreePath } = makeWorktree();
  const store = createMemoryTranscriptStore();
  try {
    const req = [];
    const a = createOpenAICompatibleAdapter({
      provider: 'deepseek', repoPath: work, apiKey: 'k', transcriptStore: store,
      fetchImpl: recordingFetch(req, [
        { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'finish', { summary: 'noop' })] },
      ]),
    });
    await a.implement({ itemId: 'p1', spec: 'do a thing', worktreePath });
    // first request = exactly system + user (fresh)
    assert.equal(req[0].length, 2);
    assert.equal(req[0][0].role, 'system');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
