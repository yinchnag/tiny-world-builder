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

const meta = store.createWorkspace({ name: 'Basic Workflow', repositoryPath: repo });
store.openWorkspace(meta.id);
store.saveLayout(meta.id, {
  viewport: { x: 0, y: 0, zoom: 1 },
  tiles: [
    {
      id: 'wf_notes', type: 'note', title: 'Instructions', x: 80, y: 120, w: 300, h: 200, status: 'idle',
      data: { note: 'Basic workflow demo. The Agent tile runs `node agent.js`, which registers with Contex and reports progress. Start CodeSurf with --contex, then click ▶ on the Agent tile and watch its status dot.' },
    },
    {
      id: 'wf_agent', type: 'terminal', title: 'Agent', x: 460, y: 120, w: 480, h: 320, status: 'idle',
      data: { command: 'node agent.js' },
    },
  ],
  links: [{ id: 'wf_link', source: 'wf_notes', target: 'wf_agent', directed: true }],
});
store.closeWorkspace(meta.id);

console.log(`Created workspace "${meta.name}" (${meta.id})`);
console.log(`Data dir: ${defaultDataDir()}`);
console.log('Open it in the app:  npm run app -- --contex   →  pick "Basic Workflow"  →  click ▶ on the Agent tile.');
