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
import { HARNESS_PRESETS } from './adapters/harness.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { createDaemon } from './daemon.mjs';
import { formatStatus } from './status.mjs';
import { ACTIVE } from './state-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `Polly — run a backlog of specs through implement → cross-vendor review → merge gate.

Usage:
  polly run --repo <path> --backlog <file.json> [options]
  polly run --repo <path> --spec "<one task>"   [options]
  polly status --registry <path>

commands:
  run      seed a backlog and process it until the line is idle, then print status
  daemon   keep running: process work and poll for newly-added items (Ctrl-C to stop)
  add      append items to a registry (e.g. to feed a running daemon)
  status   print the status of a registry

run/daemon options:
  --repo <path>          target git repo (required)
  --backlog <file>       JSON array of "spec" strings or { title, spec } (run/add)
  --spec "<text>"        a single inline task (run/add)
  --vendors a,b          implementer,reviewer (default: deepseek,qwen — different families)
  --base <branch>        base branch to fork from (default: main)
  --remote <name>        git remote to push to (default: origin)
  --gates "<cmd>"        gate command run in each worktree (default: npm test)
  --concurrency <n>      items in flight at once (default: 1; >1 is safe — git ops are repo-locked)
  --merge human|auto     merge policy (default: human — parks finished items for you)
  --wave <id>            tag the seeded items with a wave
  --registry <path>      where to store state (default: <repo>/.polly/registry.json)
  --local-pr             don't use gh — stub the PR + merge locally (offline testing)
  --env <path>           .env file with API keys (default: PollyArranger/.env)
  --interval <sec>       daemon idle poll interval (default: 5)

harness tuning (for claude_code / codex vendors — no key needed, uses the CLI's own auth):
  --harness-command <c>  override the CLI command (e.g. codex.cmd on Windows)
  --harness-shell        spawn via a shell (needed to run a .cmd on Windows)
  --harness-stdin        send the prompt via stdin instead of an arg (dodges shell quoting)
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
  const path = registryPathFor(opts);
  if (!path || !existsSync(path)) {
    console.error(`status: pass --registry <path> (or --repo) to an existing registry.`);
    process.exitCode = 1;
    return;
  }
  console.log(formatStatus(loadRegistry(path)));
}

/** Where the registry lives: --registry, else <repo>/.polly/registry.json. */
function registryPathFor(opts) {
  if (opts.registry) return resolve(opts.registry);
  if (opts.repo) return join(resolve(opts.repo), '.polly', 'registry.json');
  return null;
}

/** Create an empty registry file if it doesn't exist yet. */
function ensureRegistry(registryPath, { vendors, concurrency, merge }) {
  if (existsSync(registryPath)) return loadRegistry(registryPath);
  const reg = createEmptyRegistry({ vendors });
  reg.policy.concurrency = concurrency;
  reg.policy.merge = merge;
  saveRegistry(registryPath, reg);
  return reg;
}

/** Shared assembly for `run` and `daemon`: services + adapters + orchestrator. */
function buildContext(opts) {
  loadEnv(opts.env ? resolve(opts.env) : join(HERE, '..', '.env'));
  if (!opts.repo) throw new Error('--repo <path> is required');
  const repoPath = resolve(opts.repo);
  const vendors = String(opts.vendors ?? 'deepseek,qwen').split(',').map((s) => s.trim()).filter(Boolean);
  const registryPath = registryPathFor(opts);
  const concurrency = Number(opts.concurrency ?? 1);
  const merge = opts.merge === 'auto' ? 'auto' : 'human';

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
  // Harness (claude/codex) tuning, applied to any harness vendor in --vendors.
  // Lets you adapt to a machine (e.g. codex.cmd on Windows) with zero code edits.
  const harness = {};
  const hOverride = {};
  if (typeof opts['harness-command'] === 'string') hOverride.command = opts['harness-command'];
  if (opts['harness-shell']) hOverride.shell = true;
  if (opts['harness-stdin']) hOverride.forceStdin = true;
  if (Object.keys(hOverride).length) {
    for (const v of vendors) if (HARNESS_PRESETS[v]) harness[v] = hOverride;
  }

  const adapters = createRealAdapters({ vendors, repoPath, harness });
  const orchestrator = createOrchestrator({ store: createFileStore(), registryPath, adapters, services });
  return { repoPath, vendors, registryPath, concurrency, merge, orchestrator };
}

// Print the item snapshot only when it changes.
function snapshotPrinter() {
  let prev = '';
  return (r) => {
    const active = r.items.filter((i) => ACTIVE.includes(i.status)).length;
    const snap = r.items.map((i) => `${i.id}:${i.status}`).join('  ');
    if (snap !== prev) { prev = snap; console.log(`(active=${active})  ${snap || '(empty)'}`); }
  };
}

async function runPipeline(opts) {
  const ctx = buildContext(opts);
  const reg = createEmptyRegistry({ vendors: ctx.vendors });
  reg.policy.concurrency = ctx.concurrency;
  reg.policy.merge = ctx.merge;
  seedItems(reg, loadBacklog(opts), { wave: opts.wave ?? null });
  saveRegistry(ctx.registryPath, reg);

  console.log(`Polly: ${reg.items.length} item(s), vendors=${ctx.vendors.join('→')}, ` +
    `concurrency=${ctx.concurrency}, merge=${ctx.merge}`);
  console.log(`Repo: ${ctx.repoPath}\nRegistry: ${ctx.registryPath}\n`);

  await ctx.orchestrator.run({ onTick: snapshotPrinter() });
  console.log('\n' + formatStatus(loadRegistry(ctx.registryPath)));
}

async function runDaemon(opts) {
  const ctx = buildContext(opts);
  ensureRegistry(ctx.registryPath, { vendors: ctx.vendors, concurrency: ctx.concurrency, merge: ctx.merge });
  const intervalMs = Number(opts.interval ?? 5) * 1000;

  console.log(`Polly daemon: polling ${ctx.registryPath} every ${intervalMs / 1000}s. Ctrl-C to stop.`);
  console.log(`(feed it work from another shell: polly add --repo ${ctx.repoPath} --spec "...")\n`);

  const print = snapshotPrinter();
  const daemon = createDaemon({
    orchestrator: ctx.orchestrator,
    intervalMs,
    onTick: () => print(loadRegistry(ctx.registryPath)),
    onError: (err) => console.error(`tick error: ${err.message}`),
  });

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) return;
    stopping = true;
    console.log('\nstopping (finishing current tick)…');
    daemon.stop();
  });

  await daemon.start();
  console.log('\n' + formatStatus(loadRegistry(ctx.registryPath)));
}

function runAdd(opts) {
  const registryPath = registryPathFor(opts);
  if (!registryPath) throw new Error('add: pass --registry <path> or --repo <path>');
  const vendors = String(opts.vendors ?? 'deepseek,qwen').split(',').map((s) => s.trim()).filter(Boolean);
  const reg = ensureRegistry(registryPath, {
    vendors,
    concurrency: Number(opts.concurrency ?? 1),
    merge: opts.merge === 'auto' ? 'auto' : 'human',
  });
  const created = seedItems(reg, loadBacklog(opts), { wave: opts.wave ?? null });
  saveRegistry(registryPath, reg);
  console.log(`Added ${created.length} item(s) to ${registryPath}:`);
  for (const i of created) console.log(`  ${i.id}  ${i.title}`);
}

export async function runCli(opts) {
  switch (opts.command) {
    case 'run': return runPipeline(opts);
    case 'daemon': return runDaemon(opts);
    case 'add': return runAdd(opts);
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
