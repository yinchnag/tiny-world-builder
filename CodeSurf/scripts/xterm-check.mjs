// Opt-in browser check for the xterm.js terminal (needs a global Playwright +
// the xterm deps from `npm install`). Boots a throwaway server, verifies xterm
// mounts, renders process output (a real TTY under node-pty), and routes
// keystrokes to stdin. Not part of `npm test` (needs a browser).
//
//     npm install && npm i -g playwright && npx playwright install chromium
//     node scripts/xterm-check.mjs

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';
import { TerminalManager, ptyAvailable } from '../src/terminal.mjs';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); }
  catch { try { return require('playwright'); } catch { return null; } }
}
const pw = loadPlaywright();
if (!pw) { console.log('Playwright not installed — skipping xterm check.'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (n, p) => checks.push({ n, p: !!p });

const repo = mkdtempSync(join(tmpdir(), 'cs-xt-repo-'));
writeFileSync(join(repo, 'echo.js'),
  "process.stdout.write('READY isTTY='+process.stdout.isTTY+'\\n');process.stdin.on('data',d=>process.stdout.write('GOT['+String(d).trim()+']\\n'));");
const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), 'cs-xt-')));
const meta = store.createWorkspace({ name: 'XT', repositoryPath: repo });
store.openWorkspace(meta.id);
store.saveLayout(meta.id, { viewport: { x: 0, y: 0, zoom: 1 }, links: [], tiles: [
  { id: 'xt', type: 'terminal', title: 'Term', x: 80, y: 80, w: 640, h: 380, status: 'idle', data: {} },
] });
store.closeWorkspace(meta.id);

const terminals = new TerminalManager({ pty: ptyAvailable() });
const { server, url } = await startServer({ store, terminals, port: 0 });
const BASE = url.replace(/\/$/, '');
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1000, height: 700 } }).then((c) => c.newPage());
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const readXterm = () => page.evaluate(() => {
  const ui = window.__terminalUIs && window.__terminalUIs.get('xt');
  if (!ui || !ui.term) return null;
  const b = ui.term.buffer.active; let s = '';
  for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '\n';
  return s;
});

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(600);
  check('xterm mounted (not the <pre> fallback)', (await page.locator('.tile[data-id="xt"] .xterm').count()) === 1);

  await page.fill('.tile[data-id="xt"] .term-cmd', 'node echo.js');
  await page.click('.tile[data-id="xt"] .term-start');
  let dl = Date.now() + 6000, ready = false;
  while (Date.now() < dl) { const t = await readXterm(); if (t && /READY/.test(t)) { ready = true; break; } await sleep(150); }
  check('xterm rendered process output (READY)', ready);
  check('child reports a real TTY (PTY backend)', !ptyAvailable() || /isTTY=true/.test(await readXterm()));

  await page.click('.tile[data-id="xt"] .xterm');
  await page.keyboard.type('hi');
  await page.keyboard.press('Enter');
  dl = Date.now() + 5000; let got = false;
  while (Date.now() < dl) { const t = await readXterm(); if (t && /GOT\[hi\]/.test(t)) { got = true; break; } await sleep(150); }
  check('keystrokes routed to stdin (GOT[hi])', got);
  check('no page errors', errs.length === 0);
} finally {
  await browser.close();
  terminals.stopAll();
  server.close();
}

for (const c of checks) console.log(`${c.p ? 'ok  ' : 'FAIL'}  ${c.n}`);
console.log(`\n${checks.filter((c) => c.p).length}/${checks.length} xterm checks passed (pty=${ptyAvailable()})`);
process.exit(checks.every((c) => c.p) ? 0 : 1);
