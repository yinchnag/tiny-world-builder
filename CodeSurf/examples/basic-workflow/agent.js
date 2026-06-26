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

async function setState(fields) {
  return rpc('tools/call', { name: 'peer_set_state', arguments: { tile_id: CARD, tile_type: 'terminal', ...fields } });
}

async function main() {
  console.log(`agent online — CARD_ID=${CARD}`);
  if (!URL || !TOKEN) {
    console.log('CONTEX_URL/CONTEX_TOKEN not set — start CodeSurf with --contex to enable coordination.');
    console.log('(running standalone; nothing to register)');
    return;
  }
  console.log('connecting to Contex…');
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'demo-agent', version: '0.1' } });
  await rpc('notifications/initialized', undefined, true);

  await setState({ status: 'working', task: 'Analyzing the task', progress: 10 });
  console.log('▶ step 1/3 — analyzing');
  await sleep(1500);

  await setState({ status: 'working', task: 'Doing the work', progress: 55 });
  console.log('▶ step 2/3 — working');
  await sleep(1500);

  await setState({ status: 'working', task: 'Wrapping up', progress: 90 });
  console.log('▶ step 3/3 — finishing');
  await sleep(1200);

  await setState({ status: 'done', task: 'Complete', summary: 'Basic workflow demo finished — registered, worked, reported.' });
  console.log('✓ done — reported status=done to Contex. Watch this tile\'s status dot turn green.');
}

main().catch((e) => { console.error('agent error:', e.message); process.exit(1); });
