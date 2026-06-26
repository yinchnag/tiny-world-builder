import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ContexSupervisor } from '../src/contex.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'fake-contex.mjs');

function supervisor(extra = {}) {
  const { args = [], ...rest } = extra;
  return new ContexSupervisor({ command: process.execPath, args: [FAKE, ...args], ...rest });
}

test('start() resolves with the parsed handshake', async () => {
  const sup = supervisor();
  const hs = await sup.start();
  assert.match(hs.url, /\/mcp$/);
  assert.ok(hs.token && hs.token.length > 10);
  assert.equal(hs.workspace_id, 'ws_fake');
  await sup.stop();
});

test('a crash triggers a restart with a rotated token', async () => {
  const sup = supervisor({ args: ['--exit-after', '120'], backoffMs: 50 });
  const first = await sup.start();
  const [second] = await once(sup, 'restart');
  assert.notEqual(second.token, first.token, 'restart should mint a new token');
  await sup.stop();
});

test('stop() disables restart and kills the process', async () => {
  const sup = supervisor();
  await sup.start();
  let restarted = false;
  sup.on('restart', () => { restarted = true; });
  await sup.stop();
  assert.equal(sup.child, null);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(restarted, false, 'must not restart after an explicit stop');
});

test('maxRestarts gives up after the limit', async () => {
  const sup = supervisor({ args: ['--exit-after', '60'], backoffMs: 20, maxRestarts: 1 });
  await sup.start();
  const [reason] = await Promise.race([
    once(sup, 'giveup').then(() => ['giveup']),
    new Promise((r) => setTimeout(() => r(['timeout']), 3000)),
  ]);
  assert.equal(reason, 'giveup');
  await sup.stop();
});
