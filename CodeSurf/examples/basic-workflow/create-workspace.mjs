// Creates the "Basic Workflow" workspace in CodeSurf's data dir so it shows up
// in the app's workspace picker. Lays out two linked tiles:
//   • a Note tile with instructions,
//   • a Terminal tile preset to run this folder's agent.js.
//
// Run:  node examples/basic-workflow/create-workspace.mjs
//   (honors CODESURF_DATA_DIR; without it, writes to the default per-user dir)

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { openCodeSurf, defaultDataDir } from '../../src/index.mjs';

const repo = dirname(fileURLToPath(import.meta.url)); // this examples folder = the agent's cwd
const { store } = openCodeSurf();

// idempotent: reuse the existing "Basic Workflow" workspace if present
const existing = store.listWorkspaces({ includeArchived: true }).find((w) => w.name === 'Basic Workflow');
const id = existing ? existing.id : store.createWorkspace({ name: 'Basic Workflow', repositoryPath: repo }).id;

store.openWorkspace(id);
store.saveLayout(id, {
  viewport: { x: 0, y: 0, zoom: 1 },
  tiles: [
    {
      id: 'wf_notes', type: 'note', title: 'What this does', x: 80, y: 120, w: 320, h: 250, status: 'idle',
      data: { note: 'A coordinator-agent demo. Click ▶ on the Agent tile. The agent: (1) registers with Contex (dot turns blue); (2) writes a "Plan" document tile with real content; (3) spawns a "Worker" terminal tile that auto-runs its OWN agent (worker.js) — a second agent that writes WORKER_OUTPUT.md; (4) finishes (dot turns green). Two agents collaborating on one canvas. Tip: change worker.js to `claude -p "<task>"` to run a real agent. Needs Contex (the desktop app starts it automatically).' },
    },
    {
      id: 'wf_agent', type: 'terminal', title: 'Agent', x: 480, y: 120, w: 480, h: 320, status: 'idle',
      data: { command: 'node agent.js' },
    },
  ],
  links: [{ id: 'wf_link', source: 'wf_notes', target: 'wf_agent', directed: true }],
});
store.closeWorkspace(id);

console.log(`${existing ? 'Updated' : 'Created'} workspace "Basic Workflow" (${id})`);
console.log(`Data dir: ${defaultDataDir()}`);
console.log('Open it:  npm run app   →  pick "Basic Workflow"  →  click ▶ on the Agent tile.');
