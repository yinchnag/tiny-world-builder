// Offline demo — a wave of items flowing through the line concurrently (Phase 4).
//
//   npm run demo:waves
//
// Uses MOCK adapters + services (no network, instant), so you can watch the WIP
// cap and wave progress without spending anything. Seeds a 5-item wave, runs the
// orchestrator with concurrency=2 and auto-merge, and prints the wave report each
// time the picture changes.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createFileStore, createEmptyRegistry, saveRegistry } from './registry/store.mjs';
import { createMockAdapter } from './adapters/mock.mjs';
import { createMockServices } from './services/mock.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { seedItems } from './planner.mjs';
import { formatReport } from './report.mjs';
import { ACTIVE } from './state-machine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runDir = join(here, '..', '.run');
const registryPath = join(runDir, 'waves-registry.json');

async function main() {
  mkdirSync(runDir, { recursive: true });

  const reg = createEmptyRegistry({ vendors: ['deepseek', 'qwen'] });
  reg.policy.merge = 'auto';
  reg.policy.concurrency = 2; // WIP cap — at most 2 items in flight at once
  seedItems(reg, [
    'Add a hello banner',
    'Add a settings panel',
    'Fix the off-by-one in pagination',
    'Add dark mode toggle',
    'Write the about page',
  ], { wave: 'wave1' });
  saveRegistry(registryPath, reg);

  const adapters = {
    deepseek: createMockAdapter({ vendor: 'deepseek' }),
    // Make item p3 need one fix round, the rest pass clean — to show variety.
    qwen: createMockAdapter({ vendor: 'qwen', reviewPlan: { p3: ['BLOCKING', 'CLEAN'] } }),
  };
  const orch = createOrchestrator({
    store: createFileStore(), registryPath, adapters, services: createMockServices(),
  });

  console.log('Wave demo — 5 items, concurrency=2, auto-merge:\n');
  let prev = '';
  let tickNo = 0;
  await orch.run({
    onTick: (r) => {
      tickNo += 1;
      const active = r.items.filter((i) => ACTIVE.includes(i.status)).length;
      const snapshot = r.items.map((i) => `${i.id}:${i.status}`).join('  ');
      if (snapshot !== prev) {
        prev = snapshot;
        console.log(`tick ${String(tickNo).padStart(2)} (active=${active})  ${snapshot}`);
      }
    },
  });

  console.log('\nFinal report:');
  console.log(formatReport(createFileStore().load(registryPath)));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
