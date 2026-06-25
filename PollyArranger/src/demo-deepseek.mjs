// Live demo — DeepSeek actually writing code (Phase 2.2).
//
//   npm run demo:deepseek
//
// Needs DEEPSEEK_API_KEY (loaded from the gitignored .env). Creates a throwaway
// git repo, opens a worktree, and asks DeepSeek — through the real tool-calling
// loop — to implement a small task. Then prints what it produced. This makes a
// REAL network call; it is NOT part of `npm test`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnv } from './util/env.mjs';
import { createGitServices } from './services/git.mjs';
import { createOpenAICompatibleAdapter } from './adapters/openai-compatible.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, '..', '.env'));

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('No DEEPSEEK_API_KEY (put it in PollyArranger/.env). Aborting.');
    process.exitCode = 1;
    return;
  }

  // Throwaway repo with an initial commit on main.
  const root = mkdtempSync(join(tmpdir(), 'polly-deepseek-'));
  const work = join(root, 'work');
  execFileSync('git', ['init', work]);
  git(work, 'config', 'user.email', 'polly@demo.local');
  git(work, 'config', 'user.name', 'Polly Demo');
  git(work, 'checkout', '-b', 'main');
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-m', 'init']);

  const svc = createGitServices({ repoPath: work, baseRef: 'main' });
  const item = {
    id: 'p1',
    title: 'Add a greeting module',
    branch: null,
    worktree: null,
  };
  const loc = svc.worktree.create({ item });
  item.branch = loc.branch;
  item.worktree = loc.worktree;

  const adapter = createOpenAICompatibleAdapter({ provider: 'deepseek', repoPath: work });

  console.log(`Asking DeepSeek to implement: "${item.title}"`);
  console.log(`(worktree: ${join(work, loc.worktree)})\n`);

  const res = await adapter.implement({
    itemId: item.id,
    spec:
      'Create a file greeting.mjs that exports a function greet(name) returning ' +
      'the string "Hello, <name>! Welcome to TinyWorld." Also add a one-line ' +
      'README note. Keep it minimal.',
    worktreePath: loc.worktree,
  });

  console.log('Result:', JSON.stringify({ ok: res.ok, summary: res.summary, commits: res.commits }, null, 2));

  if (res.ok) {
    const wt = join(work, loc.worktree);
    console.log('\nFiles produced:');
    for (const f of readdirSync(wt)) {
      if (f === '.git') continue;
      console.log(`\n----- ${f} -----`);
      const abs = join(wt, f);
      if (existsSync(abs)) console.log(readFileSync(abs, 'utf8').trimEnd());
    }
    console.log('\nCommit:', git(wt, 'log', '--oneline', '-1'));
  }
  console.log(`\n(throwaway repo left at ${root} for inspection)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
