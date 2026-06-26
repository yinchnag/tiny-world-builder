import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Terminal, TerminalManager, ensureMcpConfig } from '../src/terminal.mjs';

// a child that prints injected env then echoes stdin lines
const ECHO = `
process.stdout.write('CARD=' + (process.env.CARD_ID || '') + '\\n');
if (process.env.CONTEX_URL) process.stdout.write('CURL=' + process.env.CONTEX_URL + '\\n');
process.stdin.on('data', (d) => process.stdout.write('ECHO:' + d));
`;

function waitForData(term, pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    let acc = '';
    const onData = (s) => { acc += s; if (pred(acc)) { cleanup(); resolve(acc); } };
    const to = setTimeout(() => { cleanup(); reject(new Error('timeout; got: ' + JSON.stringify(acc))); }, ms);
    function cleanup() { clearTimeout(to); term.off('data', onData); }
    term.on('data', onData);
  });
}

test('start injects CARD_ID and streams stdout', async () => {
  const t = new Terminal('tile_echo');
  t.start({ command: process.execPath, args: ['-e', ECHO] });
  assert.equal(t.status, 'running');
  const out = await waitForData(t, (a) => a.includes('CARD=tile_echo'));
  assert.match(out, /CARD=tile_echo/);
  assert.match(t.buffer, /CARD=tile_echo/); // retained in scrollback
  t.stop();
  await once(t, 'exit');
});

test('stdin write is echoed back', async () => {
  const t = new Terminal('tile_in');
  t.start({ command: process.execPath, args: ['-e', ECHO] });
  await waitForData(t, (a) => a.includes('CARD='));
  t.write('hello\n');
  const out = await waitForData(t, (a) => a.includes('ECHO:hello'));
  assert.match(out, /ECHO:hello/);
  t.stop();
  await once(t, 'exit');
});

test('stop terminates the process and emits exit', async () => {
  const t = new Terminal('tile_stop');
  t.start({ command: process.execPath, args: ['-e', ECHO] });
  await waitForData(t, (a) => a.includes('CARD='));
  t.stop();
  const [info] = await once(t, 'exit');
  assert.equal(t.status, 'exited');
  assert.ok('code' in info);
});

test('a spawn error surfaces as an exit with an error note', async () => {
  const t = new Terminal('tile_bad');
  t.start({ command: 'definitely-not-a-real-binary-xyz', args: [] });
  const [info] = await once(t, 'exit');
  assert.ok(info.error, 'should carry an error message');
  assert.match(t.buffer, /spawn error/);
});

test('scrollback is bounded by maxBuffer', async () => {
  const t = new Terminal('tile_cap', { maxBuffer: 500 });
  t.start({ command: process.execPath, args: ['-e', 'for(let i=0;i<5000;i++)process.stdout.write("x");'] });
  await once(t, 'exit');
  assert.ok(t.buffer.length <= 500, `buffer ${t.buffer.length} should be <= 500`);
});

test('start refuses a second concurrent run', async () => {
  const t = new Terminal('tile_busy');
  t.start({ command: process.execPath, args: ['-e', ECHO] });
  assert.throws(() => t.start({ command: process.execPath, args: ['-e', ECHO] }), /already running/);
  t.stop();
  await once(t, 'exit');
});

test('manager injects Contex env from the connection', async () => {
  const fakeContex = { agentEnv: () => ({ CONTEX_URL: 'http://127.0.0.1:9/mcp', CONTEX_TOKEN: 'tok-secret', CONTEX_WORKSPACE: 'ws_1' }) };
  const mgr = new TerminalManager({ contex: fakeContex });
  const dataEvents = [];
  mgr.on('data', (e) => dataEvents.push(e));
  mgr.start('tile_m', { command: process.execPath, args: ['-e', ECHO] });
  const t = mgr.ensure('tile_m');
  const out = await waitForData(t, (a) => a.includes('CURL=http://127.0.0.1:9/mcp'));
  assert.match(out, /CURL=http:\/\/127\.0\.0\.1:9\/mcp/);
  // manager re-emits data tagged with the tile id
  assert.ok(dataEvents.some((e) => e.tileId === 'tile_m'));
  mgr.stop('tile_m');
  await once(t, 'exit');
});

test('manager status reports idle for an unknown tile', () => {
  const mgr = new TerminalManager();
  assert.deepEqual(mgr.status('nope'), { tileId: 'nope', status: 'idle', exitCode: null, command: null });
});

test('Terminal uses the pipe backend by default (zero-dep path)', async () => {
  const t = new Terminal('tile_pipe', { pty: false });
  t.start({ command: process.execPath, args: ['-e', 'process.exit(0)'] });
  await once(t, 'exit');
  assert.equal(t.backend, 'pipe');
});
// Real-PTY verification lives in `scripts/pty-check.mjs` (opt-in): node-pty is an
// optional native dep and leaves a lingering handle, so it must not gate `npm test`.

test('ensureMcpConfig writes a secret-free, env-ref contex server', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cs-mcp-'));
  const file = ensureMcpConfig(cwd);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(cfg.mcpServers.contex.type, 'http');
  assert.equal(cfg.mcpServers.contex.url, '${CONTEX_URL}');
  assert.equal(cfg.mcpServers.contex.headers.Authorization, 'Bearer ${CONTEX_TOKEN}');
  // the literal token must never be written to disk
  assert.ok(!readFileSync(file, 'utf8').includes('tok'));
});

test('ensureMcpConfig preserves other servers and is idempotent', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cs-mcp2-'));
  writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x' } } }));
  ensureMcpConfig(cwd);
  ensureMcpConfig(cwd); // twice → still one contex entry, other preserved
  const cfg = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
  assert.ok(cfg.mcpServers.other);
  assert.equal(cfg.mcpServers.contex.url, '${CONTEX_URL}');
});

test('manager writes .mcp.json on start when Contex is connected', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cs-mcp3-'));
  const fakeContex = { agentEnv: () => ({ CONTEX_URL: 'http://127.0.0.1:9/mcp', CONTEX_TOKEN: 'tok-secret', CONTEX_WORKSPACE: 'ws' }) };
  const mgr = new TerminalManager({ contex: fakeContex });
  mgr.start('tile_mcp', { command: process.execPath, args: ['-e', 'process.exit(0)'], cwd });
  const t = mgr.ensure('tile_mcp');
  await once(t, 'exit');
  assert.ok(existsSync(join(cwd, '.mcp.json')), '.mcp.json should exist');
  assert.match(t.buffer, /wrote .*\.mcp\.json/); // the notice surfaced in the tile
});
