import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Terminal, TerminalManager } from '../src/terminal.mjs';

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
