// PollyArranger — runnable demo (Phase 1).
//
// Tutorial note:
//   This wires the real orchestrator + state machine + store to MOCK adapters
//   and MOCK services, then drives one item through the whole lifecycle. It is
//   the walkthrough in docs/05-workflow-walkthrough.md, executed.
//
//   Run:  npm start   (from PollyArranger/)
//   Output goes to .run/registry.json (gitignored) so nothing tracked changes.
//
//   The reviewer is scripted to return BLOCKING then CLEAN, so you see the fix
//   loop: PLANNED -> BUILDING -> IN_REVIEW -> FIXING -> RE_REVIEW -> READY.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry } from './registry/store.mjs';
import { createMockAdapter } from './adapters/mock.mjs';
import { createMockServices } from './services/mock.mjs';
import { createOrchestrator } from './orchestrator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runDir = join(here, '..', '.run');
const registryPath = join(runDir, 'registry.json');

function seedItem() {
  return {
    id: 'p1',
    wave: null,
    title: 'Demo: add a hello banner',
    spec: 'Add a friendly hello banner to the landing page.',
    branch: null, worktree: null, base: null, pr: null,
    implementer: null, reviewer: null, convId: null, reviewConvId: null,
    status: 'PLANNED', reviewRound: 0,
    createdAt: '2026-06-24T00:00:00Z', mergedAt: null,
    review: null, gates: null, caveats: [],
  };
}

async function main() {
  mkdirSync(runDir, { recursive: true });

  // Seed a fresh registry with one PLANNED item.
  const reg = createEmptyRegistry({ vendors: ['claude_code', 'codex'] });
  reg.items.push(seedItem());
  saveRegistry(registryPath, reg);

  // Mock backends: claude implements; codex reviews BLOCKING then CLEAN.
  const adapters = {
    claude_code: createMockAdapter({ vendor: 'claude_code' }),
    codex: createMockAdapter({ vendor: 'codex', reviewPlan: { p1: ['BLOCKING', 'CLEAN'] } }),
  };
  const services = createMockServices();

  const orch = createOrchestrator({
    store: createFileStore(),
    registryPath,
    adapters,
    services,
  });

  console.log('Polly demo — driving item p1 through the lifecycle:\n');
  let prev = 'PLANNED';
  console.log(`  start: ${prev}`);
  const final = await orch.run({
    onTick: (r) => {
      const s = r.items[0].status;
      if (s !== prev) {
        console.log(`     ->  ${s}`);
        prev = s;
      }
    },
  });

  const it = final.items[0];
  console.log(`\nFinal: ${it.status}  (pr #${it.pr}, ${it.reviewRound} review round(s))`);
  console.log(`Implementer: ${it.implementer}   Reviewer: ${it.reviewer}`);
  console.log(`Registry written to: ${registryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
