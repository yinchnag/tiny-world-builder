// A REAL agent for the Chat tile: bridges chat messages to the `claude` CLI.
// Each message you type is sent to `claude -p` (headless), and Claude's actual
// answer is sent back to the Chat tile. Conversation continuity is kept via the
// returned session id (--resume), so it remembers the thread.
//
// Needs the `claude` CLI on PATH (you have it — you're using Claude Code).
// Note: each message is a real Claude API call (uses tokens + a few seconds).
//
// Runs Claude in a neutral temp dir so this repo's CLAUDE.md/.mcp.json don't
// steer it. To let Claude work on a real repo, change `WORK` to that repo path.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = process.env.CONTEX_URL, TOKEN = process.env.CONTEX_TOKEN, CARD = process.env.CARD_ID || 'agent_main';
const CHAT = 'chat_main';
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

function resolveClaude() {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) { const f = join(dir, 'claude' + ext); if (existsSync(f)) return f; }
  }
  return 'claude';
}
const CLAUDE = resolveClaude();
const WORK = mkdtempSync(join(tmpdir(), 'claude-bridge-'));
let claudeSession = null;

function askClaude(prompt) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (claudeSession) args.push('--resume', claudeSession);
    let out = '', err = '';
    let c;
    try { c = spawn(CLAUDE, args, { cwd: WORK }); }
    catch (e) { return resolve('[could not start claude: ' + e.message + ']'); }
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => resolve('[claude spawn failed: ' + e.message + ']'));
    c.on('exit', () => {
      try { const j = JSON.parse(out); if (j.session_id) claudeSession = j.session_id; resolve(j.result || '(claude returned no text)'); }
      catch { resolve('[claude error] ' + (err.trim() || out.trim() || 'no output').slice(0, 500)); }
    });
  });
}

console.log(`claude-bridge online — CARD_ID=${CARD}  (claude: ${CLAUDE})`);
if (!URL || !TOKEN) { console.log('No Contex env — start the desktop app, then click ▶.'); process.exit(0); }

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-bridge', version: '0.1' } });
await rpc('notifications/initialized', undefined, true);
await call('peer_set_state', { tile_id: CARD, tile_type: 'terminal', status: 'working', task: 'bridging chat to claude' });
await call('link_tiles', { source_tile_id: CHAT, target_tile_id: CARD });
console.log('linked to chat tile. Type in the Chat tile — I forward to real claude and reply here.');

for (;;) {
  try {
    const msgs = sc(await call('peer_read_messages', { tile_id: CARD, unread_only: true }))?.messages || [];
    for (const m of msgs) {
      console.log(`← "${m.text}"  — asking claude…`);
      await call('peer_set_state', { tile_id: CARD, tile_type: 'terminal', status: 'working', task: 'asking claude' });
      const answer = await askClaude(m.text);
      await call('peer_send_message', { from_tile_id: CARD, to_tile_id: m.from_tile_id, text: answer });
      await call('peer_set_state', { tile_id: CARD, tile_type: 'terminal', status: 'idle', task: 'waiting' });
      console.log(`→ ${answer.slice(0, 200)}${answer.length > 200 ? '…' : ''}`);
    }
  } catch (e) { console.log('poll error:', e.message); }
  await sleep(700);
}
