// cli.mjs — the turnkey command (ⓠ). Drives the whole production line on a real
// repo + a backlog of specs, with one command.
//
//   npm run polly -- run --repo <path> --backlog <file.json> [options]
//   npm run polly -- run --repo <path> --spec "do one thing"
//   npm run polly -- status --registry <path>
//
// It is a thin assembler over the pieces every demo already uses: seedItems →
// createGitServices → createRealAdapters → createOrchestrator → run → formatStatus.
//
// `parseArgs` and `loadBacklog` are exported and unit-tested; `main()` only runs
// when the file is invoked directly.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './util/env.mjs';
import { createFileStore, createEmptyRegistry, saveRegistry, loadRegistry } from './registry/store.mjs';
import { seedItems } from './planner.mjs';
import { createGitServices, localMergeStrategy } from './services/git.mjs';
import { createRealAdapters } from './adapters/factory.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { formatStatus } from './status.mjs';
import { ACTIVE } from './state-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `Polly — run a backlog of specs through implement → cross-vendor review → merge gate.

Usage:
  polly run --repo <path> --backlog <file.json> [options]
  polly run --repo <path> --spec "<one task>"   [options]
  polly status --registry <path>

run options:
  --repo <path>          target git repo (required)
  --backlog <file>       JSON array of "spec" strings or { title, spec } (or use --spec)
  --spec "<text>"        a single inline task (instead of --backlog)
  --vendors a,b          implementer,reviewer (default: deepseek,qwen — different families)
  --base <branch>        base branch to fork from (default: main)
  --remote <name>        git remote to push to (default: origin)
  --gates "<cmd>"        gate command run in each worktree (default: npm test)
  --concurrency <n>      items in flight at once (default: 1 — safe without a git lock)
  --merge human|auto     merge policy (default: human — parks finished items for you)
  --wave <id>            tag the seeded items with a wave
  --registry <path>      where to store state (default: <repo>/.polly/registry.json)
  --local-pr             don't use gh — stub the PR + merge locally (offline testing)
  --env <path>           .env file with API keys (default: PollyArranger/.env)
`;

/** Minimal argv parser: first token is the command; --key value / --flag after. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true; // flag
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

/** Resolve the backlog into an array of entries (strings or { title, spec }). */
export function loadBacklog(opts) {
  if (opts.backlog) {
    const parsed = JSON.parse(readFileSync(resolve(opts.backlog), 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('--backlog file must contain a JSON array');
    return parsed;
  }
  if (opts.spec && typeof opts.spec === 'string') {
    const title = opts.spec.split('\n')[0].slice(0, 60);
    return [{ title, spec: opts.spec }];
  }
  throw new Error('provide --backlog <file.json> or --spec "<text>"');
}

function runStatus(opts) {
  const path = opts.registry;
  if (!path || !existsSync(path)) {
    console.error(`status: pass --registry <path> to an existing registry.`);
    process.exitCode = 1;
    return;
  }
  console.log(formatStatus(loadRegistry(path)));
}

async function runPipeline(opts) {
  if (!opts.repo) throw new Error('--repo <path> is required');
  loadEnv(opts.env ? resolve(opts.env) : join(HERE, '..', '.env'));

  const repoPath = resolve(opts.repo);
  const vendors = String(opts.vendors ?? 'deepseek,qwen').split(',').map((s) => s.trim()).filter(Boolean);
  const registryPath = opts.registry ? resolve(opts.registry) : join(repoPath, '.polly', 'registry.json');

  const reg = createEmptyRegistry({ vendors });
  reg.policy.concurrency = Number(opts.concurrency ?? 1);
  reg.policy.merge = opts.merge === 'auto' ? 'auto' : 'human';
  seedItems(reg, loadBacklog(opts), { wave: opts.wave ?? null });
  saveRegistry(registryPath, reg);

  let prSeq = 1000;
  const services = createGitServices({
    repoPath,
    remote: opts.remote ?? 'origin',
    baseRef: opts.base ?? 'main',
    gatesCommand: typeof opts.gates === 'string' ? opts.gates : 'npm test',
    ...(opts['local-pr']
      ? { createPullRequest: () => (prSeq += 1), mergePullRequest: localMergeStrategy }
      : {}),
  });
  const adapters = createRealAdapters({ vendors, repoPath });
  const orch = createOrchestrator({ store: createFileStore(), registryPath, adapters, services });

  console.log(`Polly: ${reg.items.length} item(s), vendors=${vendors.join('→')}, ` +
    `concurrency=${reg.policy.concurrency}, merge=${reg.policy.merge}`);
  console.log(`Repo: ${repoPath}\nRegistry: ${registryPath}\n`);

  let prev = '';
  await orch.run({
    onTick: (r) => {
      const active = r.items.filter((i) => ACTIVE.includes(i.status)).length;
      const snap = r.items.map((i) => `${i.id}:${i.status}`).join('  ');
      if (snap !== prev) { prev = snap; console.log(`(active=${active})  ${snap}`); }
    },
  });

  console.log('\n' + formatStatus(loadRegistry(registryPath)));
}

export async function runCli(opts) {
  switch (opts.command) {
    case 'run': return runPipeline(opts);
    case 'status': return runStatus(opts);
    default:
      console.log(USAGE);
      if (opts.command && opts.command !== 'help' && opts.command !== '--help') process.exitCode = 1;
      return undefined;
  }
}

function main() {
  runCli(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
