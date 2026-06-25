// Live end-to-end demo — the WHOLE production line, for real (Phase 3).
//
//   npm run demo:pipeline
//
// Drives one item through the real orchestrator with:
//   * real git services (worktree/commit/push to a LOCAL bare remote; PR stubbed)
//   * a REAL DeepSeek implementer (writes + commits actual code via the tool loop)
//   * a REAL Qwen reviewer (different family → genuine cross-vendor review)
// Merge policy = human, so it parks at READY_FOR_HUMAN_MERGE (or BLOCKED if the
// review can't converge). Needs DEEPSEEK_API_KEY + DASHSCOPE_API_KEY in .env.
// Makes real network calls; NOT part of `npm test`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnv } from './util/env.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry } from './registry/store.mjs';
import { createGitServices } from './services/git.mjs';
import { createRealAdapters } from './adapters/factory.mjs';
import { createOrchestrator } from './orchestrator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, '..', '.env'));

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

async function main() {
  for (const k of ['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY']) {
    if (!process.env[k]) { console.error(`Missing ${k} in .env. Aborting.`); process.exitCode = 1; return; }
  }

  // Throwaway repo + local bare remote (so push works without GitHub).
  const root = mkdtempSync(join(tmpdir(), 'polly-pipeline-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', bare]);
  execFileSync('git', ['clone', bare, work]);
  git(work, 'config', 'user.email', 'polly@demo.local');
  git(work, 'config', 'user.name', 'Polly Demo');
  git(work, 'checkout', '-b', 'main');
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-m', 'init']);
  git(work, 'push', '-u', 'origin', 'main');

  const registryPath = join(root, 'registry.json');
  const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
  reg.items.push({
    id: 'p1', wave: null,
    title: 'Add an isEven utility',
    spec:
      'Create a file iseven.mjs that exports a function isEven(n) returning a ' +
      'boolean for whether the integer n is even. Handle negative numbers. Add a ' +
      'short JSDoc comment. Keep it minimal and correct.',
    branch: null, worktree: null, base: null, pr: null,
    implementer: null, reviewer: null, convId: null, reviewConvId: null,
    status: 'PLANNED', reviewRound: 0,
    createdAt: '2026-06-25T00:00:00Z', mergedAt: null, review: null, gates: null, caveats: [],
  });
  saveRegistry(registryPath, reg);

  const services = createGitServices({
    repoPath: work, remote: 'origin', baseRef: 'main',
    gatesCommand: 'node -e "process.exit(0)"', // no test suite in the throwaway repo
    createPullRequest: () => 1,                 // offline PR stub (no GitHub)
  });
  const adapters = createRealAdapters({ vendors: ['deepseek', 'qwen'], repoPath: work });

  const orch = createOrchestrator({ store: createFileStore(), registryPath, adapters, services });

  console.log('Live pipeline — DeepSeek implements, Qwen reviews:\n');
  let prev = '';
  const final = await orch.run({
    maxTicks: 40,
    onTick: (r) => {
      const it = r.items[0];
      if (it.status !== prev) {
        prev = it.status;
        let extra = '';
        if (it.review) extra = `  [review#${it.review.round}: ${it.review.verdict}${it.review.findings?.length ? ` (${it.review.findings.length} finding/s)` : ''}]`;
        console.log(`  ${it.status}${extra}`);
      }
    },
  });

  const it = final.items[0];
  console.log(`\nFinal: ${it.status}  implementer=${it.implementer}  reviewer=${it.reviewer}  rounds=${it.reviewRound}`);
  if (it.review?.findings?.length) {
    console.log('Reviewer findings:');
    for (const f of it.review.findings) console.log(`  - [${f.severity}] ${f.where}: ${f.what}`);
  }

  // Show the code DeepSeek produced.
  if (it.worktree && existsSync(join(work, it.worktree))) {
    const wt = join(work, it.worktree);
    for (const f of readdirSync(wt)) {
      if (f === '.git') continue;
      console.log(`\n----- ${f} -----\n${readFileSync(join(wt, f), 'utf8').trimEnd()}`);
    }
  }
  console.log(`\n(throwaway repo at ${root})`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
