// Creates the "Chat Demo" workspace: a Chat tile linked to an Agent terminal
// that runs chat-agent.js — so you can type in the Chat tile and the agent
// replies. Idempotent (reuses the workspace by name).
//
//   node examples/chat-demo/create-workspace.mjs   →   npm run app  →  pick "Chat Demo"

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { openCodeSurf, defaultDataDir } from '../../src/index.mjs';

const repo = dirname(fileURLToPath(import.meta.url)); // this folder = the agent's cwd
const { store } = openCodeSurf();

const existing = store.listWorkspaces({ includeArchived: true }).find((w) => w.name === 'Chat Demo');
const id = existing ? existing.id : store.createWorkspace({ name: 'Chat Demo', repositoryPath: repo }).id;

store.openWorkspace(id);
store.saveLayout(id, {
  viewport: { x: 0, y: 0, zoom: 1 },
  tiles: [
    {
      id: 'wf_notes', type: 'note', title: 'How to chat', x: 60, y: 80, w: 300, h: 200, status: 'idle',
      data: { note: '1) Click ▶ on the Agent tile (starts chat-agent.js — it registers and links to this Chat). 2) Type a message in the Chat tile and press Enter. The agent replies here. Try: "hello", "status", "count to 3". Swap the Agent\'s command for `claude` to chat with a real agent.' },
    },
    { id: 'chat_main', type: 'chat', title: 'Chat', x: 60, y: 320, w: 360, h: 300, status: 'idle', data: {} },
    { id: 'agent_main', type: 'terminal', title: 'Agent', x: 480, y: 120, w: 420, h: 320, status: 'idle', data: { command: 'node chat-agent.js' } },
  ],
  links: [
    { id: 'l_chat', source: 'chat_main', target: 'agent_main', directed: false },
    { id: 'l_note', source: 'wf_notes', target: 'agent_main', directed: true },
  ],
});
store.closeWorkspace(id);

console.log(`${existing ? 'Updated' : 'Created'} workspace "Chat Demo" (${id})`);
console.log(`Data dir: ${defaultDataDir()}`);
console.log('Open it:  npm run app  →  pick "Chat Demo"  →  click ▶ on the Agent, then type in the Chat tile.');
