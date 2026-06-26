// Browser smoke test for the CodeSurf canvas (opt-in, NOT part of `npm test`).
//
// `npm test` stays zero-dependency (node --test). This harness drives the real
// canvas in headless Chromium to catch interaction regressions the unit tests
// can't see (drag, link-draw, z-order, autosave-on-unload). It needs a global
// Playwright install + browsers:
//
//     npm i -g playwright && npx playwright install chromium
//     node scripts/browser-smoke.mjs
//
// It boots its own CodeSurf server on an ephemeral port with a throwaway data
// dir, so it touches nothing real. Exits non-zero if any check fails; exits 0
// with a notice if Playwright isn't installed.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [];
  try { candidates.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch { /* npm missing */ }
  for (const root of candidates) {
    try { return require(join(root, 'playwright')); } catch { /* try next */ }
  }
  try { return require('playwright'); } catch { return null; }
}

const pw = loadPlaywright();
if (!pw) {
  console.log('Playwright not installed — skipping browser smoke. (npm i -g playwright && npx playwright install chromium)');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, pass) => { checks.push({ name, pass: !!pass }); };

// --- boot a throwaway CodeSurf server ---
const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), 'cs-bsmoke-')));
const repo = mkdtempSync(join(tmpdir(), 'cs-bsmoke-repo-'));
const ws = store.createWorkspace({ name: 'BrowserSmoke', repositoryPath: repo });
const { server, url } = await startServer({ store, port: 0 });
const BASE = url.replace(/\/$/, '');

const errors = [];
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1100, height: 800 } }).then((c) => c.newPage());
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE.ERROR: ' + m.text()); });

const ids = () => page.$$eval('.tile', (els) => els.map((e) => e.dataset.id));
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const box = (sel) => page.locator(sel).first().boundingBox();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(400);

  async function addTile(type) {
    const before = new Set(await ids());
    await page.selectOption('#tile-type', type);
    await page.click('#add-tile');
    await sleep(150);
    return (await ids()).find((x) => !before.has(x));
  }
  async function dragFrom(sel, dx, dy) {
    const c = center(await box(sel));
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 }); await page.mouse.up();
    await sleep(120);
  }

  const A = await addTile('terminal');
  const B = await addTile('chat');
  const aB = await box(`.tile[data-id="${A}"]`), bB = await box(`.tile[data-id="${B}"]`);
  check('new tiles do not stack exactly', !(Math.abs(aB.x - bB.x) < 5 && Math.abs(aB.y - bB.y) < 5));

  await dragFrom(`.tile[data-id="${A}"] .head`, -340, -150);
  await dragFrom(`.tile[data-id="${B}"] .head`, 320, 160);

  const before = await box(`.tile[data-id="${A}"]`);
  await dragFrom(`.tile[data-id="${A}"] .head`, 60, 40);
  const after = await box(`.tile[data-id="${A}"]`);
  check('head-drag moves a tile', Math.abs(after.x - before.x) > 30);

  const sBefore = await box(`.tile[data-id="${A}"]`);
  await dragFrom(`.tile[data-id="${A}"] .resize`, 70, 50);
  const sAfter = await box(`.tile[data-id="${A}"]`);
  check('resize handle grows a tile', (sAfter.width - sBefore.width) > 30);

  const p = center(await box(`.tile[data-id="${A}"] .port`));
  const d = center(await box(`.tile[data-id="${B}"] .head`));
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move((p.x + d.x) / 2, (p.y + d.y) / 2, { steps: 6 });
  await page.mouse.move(d.x, d.y, { steps: 6 }); await page.mouse.up();
  await sleep(150);
  check('port-drag creates a link', (await page.locator('#links path:not(.temp)').count()) === 1);
  check('no temp link left after linking', (await page.locator('#links path.temp').count()) === 0);
  check('link drag selected no text', (await page.evaluate(() => window.getSelection().toString())).trim() === '');

  // head-drag across another tile's body must not select text either
  await dragFrom(`.tile[data-id="${A}"] .head`, 80, 30);
  check('tile drag selected no text', (await page.evaluate(() => window.getSelection().toString())).trim() === '');

  const p2 = center(await box(`.tile[data-id="${B}"] .port`));
  await page.mouse.move(p2.x, p2.y); await page.mouse.down();
  await page.mouse.move(p2.x + 150, p2.y + 220, { steps: 8 }); await page.mouse.up();
  await sleep(150);
  check('dropping a link on empty canvas adds nothing', (await page.locator('#links path:not(.temp)').count()) === 1);
  check('no temp link left after empty drop', (await page.locator('#links path.temp').count()) === 0);

  await page.click(`.tile[data-id="${A}"] .btn.min`); await sleep(100);
  check('minimize toggles state', (await page.locator(`.tile[data-id="${A}"].minimized`).count()) === 1);
  await page.click(`.tile[data-id="${A}"] .btn.min`); await sleep(80);
  await page.click(`.tile[data-id="${A}"] .btn.pin`); await sleep(80);
  check('pin toggles state', (await page.locator(`.tile[data-id="${A}"].pinned`).count()) === 1);
  await page.click(`.tile[data-id="${A}"] .btn.pin`); await sleep(80);

  const cnt = (await ids()).length;
  await page.click(`.tile[data-id="${B}"] .btn.close`, { force: true }); await sleep(150);
  check('close button deletes a tile', (await ids()).length === cnt - 1);

  await page.reload({ waitUntil: 'networkidle' }); await sleep(500);
  check('layout persists across reload (unload flush)', (await ids()).length === cnt - 1);

  check('no console errors', errors.length === 0);
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'}  ${c.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) console.log('console/page errors:\n  ' + errors.join('\n  '));
process.exit(failed.length ? 1 : 0);
