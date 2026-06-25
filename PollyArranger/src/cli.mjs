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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
import { createPlan } from './plan.mjs';
import { formatStatus, formatHistory } from './status.mjs';
import { ACTIVE } from './state-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `Polly — run a backlog of specs through implement → cross-vendor review → merge gate.

Usage:
  polly run --repo <path> --backlog <file.json> [options]
  polly run --repo <path> --spec "<one task>"   [options]
  polly status --registry <path>

commands:
  plan     decompose a goal into a backlog file for you to review, then run
  run      seed a backlog and process it until the line is idle, then print status
  daemon   keep running: process work and poll for newly-added items (Ctrl-C to stop)
  add      append items to a registry (e.g. to feed a running daemon)
  status   print the status of a registry
  history  print the full implement<->review back-and-forth (--item <id> for one)

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
  --implementer <v>      force the default implementer vendor (S3 routing)
  --reviewer <v>         force the default reviewer vendor
  --routing <file>       routing policy JSON ({ default, rules:[{tag,implementer,reviewer}] })
  --escalate-to <v>      on review-cap, escalate the implementer to <v> once (must be in --vendors)
  --registry <path>      where to store state (default: <repo>/.polly/registry.json)
  --local-pr             fully local: no gh, no remote/push — stub the PR + merge locally
  --env <path>           .env file with API keys (default: PollyArranger/.env)
  --interval <sec>       daemon idle poll interval (default: 5)

harness tuning (for claude_code / codex vendors — no key needed, uses the CLI's own auth):
  --harness-command <c>  override the CLI command (e.g. codex.cmd on Windows)
  --harness-shell        spawn via a shell (needed to run a .cmd on Windows)
  --harness-stdin        send the prompt via stdin instead of an arg (dodges shell quoting)

plan options:
  --goal "<text>"        the goal to decompose (or --goal-file <file>)
  --planner <v>          vendor that plans (default: deepseek)
  --out <file>           where to write the backlog (default: <repo>/.polly/plan.json)
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

// `history` — the full implement↔review back-and-forth for an item (or all).
function runHistory(opts) {
  const path = registryPathFor(opts);
  if (!path || !existsSync(path)) {
    console.error(`history: pass --registry <path> (or --repo) to an existing registry.`);
    process.exitCode = 1;
    return;
  }
  const reg = loadRegistry(path);
  const items = opts.item ? reg.items.filter((i) => i.id === opts.item) : reg.items;
  if (items.length === 0) { console.error(`no item${opts.item ? ` "${opts.item}"` : 's'} found.`); process.exitCode = 1; return; }
  console.log(items.map(formatHistory).join('\n\n'));
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

/** S3 — build a routing policy from CLI flags (or a --routing JSON file). */
function routingFromOpts(opts) {
  let routing;
  if (opts.routing) routing = JSON.parse(readFileSync(resolve(opts.routing), 'utf8'));
  if (typeof opts.implementer === 'string' || typeof opts.reviewer === 'string') {
    routing = routing ?? {};
    routing.default = {
      ...(routing.default ?? {}),
      ...(typeof opts.implementer === 'string' ? { implementer: opts.implementer } : {}),
      ...(typeof opts.reviewer === 'string' ? { reviewer: opts.reviewer } : {}),
    };
  }
  if (typeof opts['escalate-to'] === 'string') {
    routing = routing ?? {};
    routing.escalateTo = opts['escalate-to'];
  }
  const autoEscalate = Boolean(opts['escalate-to'] || opts['auto-escalate']);
  return { routing, autoEscalate };
}

/** Apply routing/escalation flags onto a registry's policy. */
function applyRouting(reg, opts) {
  const { routing, autoEscalate } = routingFromOpts(opts);
  if (routing) reg.policy.routing = routing;
  if (autoEscalate) reg.policy.autoEscalate = true;
}

// Harness (claude/codex) tuning applied to any harness vendor — adapt to a
// machine (e.g. codex.cmd on Windows) with zero code edits.
function harnessOverrideFor(opts, vendors) {
  const o = {};
  if (typeof opts['harness-command'] === 'string') o.command = opts['harness-command'];
  if (opts['harness-shell']) o.shell = true;
  if (opts['harness-stdin']) o.forceStdin = true;
  const map = {};
  if (Object.keys(o).length) for (const v of vendors) if (HARNESS_PRESETS[v]) map[v] = o;
  return map;
}

/** `plan` — decompose a goal into a backlog file for you to review, then run. */
async function runPlan(opts) {
  loadEnv(opts.env ? resolve(opts.env) : join(HERE, '..', '.env'));
  if (!opts.repo) throw new Error('--repo <path> is required');
  const goal = typeof opts.goal === 'string'
    ? opts.goal
    : (opts['goal-file'] ? readFileSync(resolve(opts['goal-file']), 'utf8') : null);
  if (!goal) throw new Error('provide --goal "<text>" or --goal-file <file>');

  const repoPath = resolve(opts.repo);
  const planner = opts.planner ?? 'deepseek';
  const adapters = createRealAdapters({ vendors: [planner], repoPath, harness: harnessOverrideFor(opts, [planner]) });

  console.log(`Planning "${goal.split('\n')[0].slice(0, 60)}…" with ${planner}\n`);
  const { items } = await createPlan({ adapter: adapters[planner], repoPath, goal });

  const outPath = opts.out ? resolve(opts.out) : join(repoPath, '.polly', 'plan.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');

  console.log(`Planned ${items.length} task(s) → ${outPath}\n`);
  for (const it of items) {
    const deps = it.dependsOn?.length ? ` (after ${it.dependsOn.join(', ')})` : '';
    const tags = it.tags?.length ? ` [${it.tags.join(', ')}]` : '';
    console.log(`  ${it.id ?? '-'}  ${it.title}${deps}${tags}`);
  }
  console.log(`\nReview/edit it, then run:\n  polly run --repo ${repoPath} --backlog ${outPath}`);
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
      ? { createPullRequest: () => (prSeq += 1), mergePullRequest: localMergeStrategy, noPush: true }
      : {}),
  });
  const adapters = createRealAdapters({ vendors, repoPath, harness: harnessOverrideFor(opts, vendors) });
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
  applyRouting(reg, opts); // S3 — routing/escalation
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
  const reg = ensureRegistry(ctx.registryPath, { vendors: ctx.vendors, concurrency: ctx.concurrency, merge: ctx.merge });
  applyRouting(reg, opts); // S3 — apply routing/escalation flags onto the registry
  saveRegistry(ctx.registryPath, reg);
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
    case 'plan': return runPlan(opts);
    case 'daemon': return runDaemon(opts);
    case 'add': return runAdd(opts);
    case 'status': return runStatus(opts);
    case 'history': return runHistory(opts);
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
