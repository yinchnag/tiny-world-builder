// A tiny demo "agent" for the CodeSurf basic-workflow example.
//
// CodeSurf runs this inside a terminal tile and injects CARD_ID (= the tile id)
// plus CONTEX_URL / CONTEX_TOKEN (when started with --contex). The agent:
//   1. registers itself with Contex (peer_set_state) so the canvas shows it,
//   2. walks through a few "work" steps, updating its status/progress,
//   3. finishes (status: done) with a summary.
//
// It prints plain text only (no full-screen TUI), so it renders fine in the
// current terminal pane. Raw MCP over fetch — no dependencies.

const URL = process.env.CONTEX_URL;
const TOKEN = process.env.CONTEX_TOKEN;
const CARD = process.env.CARD_ID || 'unknown-tile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let session = null;
async function rpc(method, params, isNote = false) {
  const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  if (!isNote) msg.id = Math.floor(Math.random() * 1e6);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer ' + TOKEN,
  };
  if (session) headers['mcp-session-id'] = session;
  const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(msg) });
  if (res.headers.get('mcp-session-id')) session = res.headers.get('mcp-session-id');
  const text = await res.text();
  if (!text) return null;
  const line = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop();
  return JSON.parse(line || text);
}

async function call(name, args) { return rpc('tools/call', { name, arguments: args }); }
async function setState(fields) { return call('peer_set_state', { tile_id: CARD, tile_type: 'terminal', ...fields }); }

async function main() {
  console.log(`coordinator agent online — CARD_ID=${CARD}`);
  if (!URL || !TOKEN) {
    console.log('CONTEX_URL/CONTEX_TOKEN not set — start CodeSurf with --contex (or use the desktop app) to enable coordination.');
    console.log('(running standalone; nothing to coordinate)');
    return;
  }
  console.log('connecting to Contex…');
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'demo-agent', version: '0.1' } });
  await rpc('notifications/initialized', undefined, true);

  // 1) register so the canvas can see me (status dot turns blue = working)
  await setState({ status: 'working', task: 'Coordinating the workflow', progress: 20 });
  console.log('registered with Contex — my status dot just turned blue (working).');
  await sleep(1200);

  // 2) ask the canvas to spawn a Worker tile, linked to me (command bus)
  console.log('step 1 — asking CodeSurf to create a Worker tile on the canvas…');
  await call('canvas_create_tile', { requester_tile_id: CARD, tile_type: 'document', title: 'Worker', link_to_requester: true });
  console.log('  → requested. Watch a new "Worker" tile appear, linked to this Agent.');
  await sleep(1800);

  // 3) "work", then finish (status dot turns green = done)
  await setState({ status: 'working', task: 'Working with the team', progress: 70 });
  console.log('step 2 — doing the task…');
  await sleep(1500);

  await setState({ status: 'done', task: 'Complete', summary: 'Coordinated: spawned a Worker tile and finished the task.' });
  console.log('✓ done — my status dot is now green. The new Worker tile is the helper I created.');
}

main().catch((e) => { console.error('agent error:', e.message); process.exit(1); });
