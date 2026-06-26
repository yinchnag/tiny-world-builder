// The Worker agent — spawned by the coordinator into its own terminal tile and
// auto-run. It registers with Contex (so the Worker tile gets its own status
// dot), does a real piece of work (writes a file), and reports done.
//
// Swap this command for `claude -p "<task>"` in the coordinator to run a REAL
// agent here instead — the mechanism is identical (CARD_ID + Contex env + the
// generated .mcp.json are already injected).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.CONTEX_URL, TOKEN = process.env.CONTEX_TOKEN, CARD = process.env.CARD_ID || 'worker';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let session = null;
async function rpc(method, params, note = false) {
  const m = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  if (!note) m.id = Math.floor(Math.random() * 1e6);
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + TOKEN };
  if (session) h['mcp-session-id'] = session;
  const r = await fetch(URL, { method: 'POST', headers: h, body: JSON.stringify(m) });
  if (r.headers.get('mcp-session-id')) session = r.headers.get('mcp-session-id');
  const t = await r.text();
  return t ? JSON.parse(t.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() || t) : null;
}
const setState = (f) => rpc('tools/call', { name: 'peer_set_state', arguments: { tile_id: CARD, tile_type: 'terminal', ...f } });

console.log(`worker agent online — CARD_ID=${CARD}`);
if (URL && TOKEN) {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'worker', version: '0.1' } });
  await rpc('notifications/initialized', undefined, true);
  await setState({ status: 'working', task: 'Doing the assigned task', progress: 40 });
}
console.log('task: producing a real artifact (WORKER_OUTPUT.md)…');
await sleep(1200);

const out = [
  '# Worker output',
  '',
  `Produced by the worker agent (tile ${CARD}) at the coordinator's request.`,
  '',
  '- [x] received the task',
  '- [x] did the work',
  '- [x] wrote this file',
  '',
  'In a real workflow this agent would be `claude`/`codex` doing actual coding.',
].join('\n');
writeFileSync(join(process.cwd(), 'WORKER_OUTPUT.md'), out + '\n');
console.log('\n--- wrote WORKER_OUTPUT.md ---');
console.log(out);
console.log('------------------------------\n');

if (URL && TOKEN) await setState({ status: 'done', task: 'Complete', summary: 'Wrote WORKER_OUTPUT.md' });
console.log('✓ worker done.');
