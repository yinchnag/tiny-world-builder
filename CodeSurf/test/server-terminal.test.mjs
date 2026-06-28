import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';
import { TerminalManager } from '../src/terminal.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ECHO = `process.stdout.write('CARD=' + process.env.CARD_ID + '\\n'); process.stdin.on('data', d => process.stdout.write('ECHO:' + d));`;

async function until(fn, pred, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const v = await fn(); if (pred(v)) return v; await wait(60); }
  throw new Error('condition not met');
}

test('terminal endpoints: start, status+scrollback, input, stop over HTTP', async () => {
  const store = new WorkspaceStore(tmp('cs-term-'));
  const terminals = new TerminalManager();
  const { server, url } = await startServer({ store, terminals, port: 0 });
  const base = url.replace(/\/$/, '');
  const id = 'tile_srv';

  const start = await fetch(`${base}/api/terminals/${id}/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: process.execPath, args: ['-e', ECHO] }),
  });
  assert.equal(start.status, 200);

  // CARD_ID was injected and streamed into scrollback
  const st = await until(() => fetch(`${base}/api/terminals/${id}`).then((r) => r.json()), (s) => /CARD=tile_srv/.test(s.scrollback));
  assert.equal(st.status, 'running');

  // stdin echo
  await fetch(`${base}/api/terminals/${id}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'ping\n' }) });
  await until(() => fetch(`${base}/api/terminals/${id}`).then((r) => r.json()), (s) => /ECHO:ping/.test(s.scrollback));

  // stop
  await fetch(`${base}/api/terminals/${id}/stop`, { method: 'POST' });
  const stopped = await until(() => fetch(`${base}/api/terminals/${id}`).then((r) => r.json()), (s) => s.status === 'exited');
  assert.equal(stopped.status, 'exited');

  server.close();
  terminals.stopAll();
});

test('terminal start endpoint injects per-agent env', async () => {
  const store = new WorkspaceStore(tmp('cs-term-env-'));
  const terminals = new TerminalManager();
  const { server, url } = await startServer({ store, terminals, port: 0 });
  const base = url.replace(/\/$/, '');
  const id = 'tile_agent_env';
  const script = `process.stdout.write('AGENT=' + process.env.AGENT_ID + ':' + process.env.AGENT_ROLE + '\\n')`;

  const start = await fetch(`${base}/api/terminals/${id}/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: process.execPath, args: ['-e', script], env: { AGENT_ID: 'agent_1', AGENT_ROLE: 'reviewer' } }),
  });
  assert.equal(start.status, 200);

  await until(() => fetch(`${base}/api/terminals/${id}`).then((r) => r.json()), (s) => /AGENT=agent_1:reviewer/.test(s.scrollback));

  server.close();
  terminals.stopAll();
});

test('terminal stream delivers scrollback + live output via SSE', async () => {
  const store = new WorkspaceStore(tmp('cs-term2-'));
  const terminals = new TerminalManager();
  const { server, url } = await startServer({ store, terminals, port: 0 });
  const base = url.replace(/\/$/, '');
  const id = 'tile_sse';

  await fetch(`${base}/api/terminals/${id}/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: process.execPath, args: ['-e', ECHO] }),
  });

  const ac = new AbortController();
  const res = await fetch(`${base}/api/terminals/${id}/stream`, { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !buf.includes('CARD=tile_sse')) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  assert.match(buf, /event: status/);
  assert.match(buf, /CARD=tile_sse/);
  ac.abort();

  server.close();
  terminals.stopAll();
});

test('terminal routes are 503 when terminals are not enabled', async () => {
  const store = new WorkspaceStore(tmp('cs-term3-'));
  const { server, url } = await startServer({ store, port: 0 });
  const base = url.replace(/\/$/, '');
  const r = await fetch(`${base}/api/terminals/x/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"command":"node"}' });
  assert.equal(r.status, 503);
  server.close();
});
