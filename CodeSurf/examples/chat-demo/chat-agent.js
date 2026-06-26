// A chat-aware demo agent. CodeSurf runs it in the "Agent" terminal tile; it
// registers with Contex, links itself to the Chat tile, then polls its inbox and
// replies to whatever you type in the Chat tile. Plain Node, no deps.
//
// Swap this for a real `claude` (which checks messages per .claude/CLAUDE.md) to
// chat with a real agent — the wiring is identical.

const URL = process.env.CONTEX_URL, TOKEN = process.env.CONTEX_TOKEN, CARD = process.env.CARD_ID || 'agent_main';
const CHAT = 'chat_main'; // the Chat tile this demo is paired with (see create-workspace.mjs)
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
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const sc = (r) => r && r.result && r.result.structuredContent;

function replyFor(text) {
  const t = text.toLowerCase().trim();
  if (/\b(hi|hello|hey)\b/.test(t)) return "Hi! I'm the demo agent, listening on this canvas. Try: 'status', 'count to 3', or just chat.";
  if (t.includes('status')) return `I'm online and listening (tile ${CARD}).`;
  if (t.includes('count')) return 'Counting… 1 … 2 … 3 ✓';
  if (t.includes('help')) return "I'm a demo. Type anything and I'll reply. A real `claude` here would actually do the task.";
  return `Got it: "${text}". (I'm a demo agent — a real claude/codex would act on this.)`;
}

console.log(`chat agent online — CARD_ID=${CARD}`);
if (!URL || !TOKEN) { console.log('No Contex env — start the desktop app (it launches Contex), then click ▶.'); process.exit(0); }

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'chat-agent', version: '0.1' } });
await rpc('notifications/initialized', undefined, true);
await call('peer_set_state', { tile_id: CARD, tile_type: 'terminal', status: 'working', task: 'listening for chat' });
await call('link_tiles', { source_tile_id: CHAT, target_tile_id: CARD }); // ensure the Contex peer edge exists
console.log(`linked to chat tile "${CHAT}". Now type in the Chat tile — I'll reply here and there.`);

let handled = 0;
for (;;) {
  try {
    const msgs = sc(await call('peer_read_messages', { tile_id: CARD, unread_only: true }))?.messages || [];
    for (const m of msgs) {
      handled++;
      console.log(`← "${m.text}"  (from ${m.from_tile_id})`);
      const reply = replyFor(m.text);
      await call('peer_send_message', { from_tile_id: CARD, to_tile_id: m.from_tile_id, text: reply });
      console.log(`→ "${reply}"`);
    }
  } catch (e) { console.log('poll error:', e.message); }
  await sleep(700);
}
