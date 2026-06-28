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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';
import { TerminalManager } from '../src/terminal.mjs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [];
  if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(delimiter).filter(Boolean));
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
const demoRepo = mkdtempSync(join(tmpdir(), 'cs-bsmoke-demo-repo-'));
const workflowRepo = mkdtempSync(join(tmpdir(), 'cs-bsmoke-workflow-repo-'));
const dismissRepo = mkdtempSync(join(tmpdir(), 'cs-bsmoke-dismiss-repo-'));
writeFileSync(join(repo, 'echo.js'),
  "process.stdout.write('CARD='+process.env.CARD_ID+'\\n');process.stdin.on('data',d=>process.stdout.write('ECHO:'+d));");
writeFileSync(join(repo, 'PHASE9.md'), '# Phase 9 Smoke\n\n- Browser tile\n- Document tile\n');
execSync('git init -b main', { cwd: repo, stdio: 'ignore' });
execSync('git config user.email codesurf@example.test', { cwd: repo, stdio: 'ignore' });
execSync('git config user.name "CodeSurf Smoke"', { cwd: repo, stdio: 'ignore' });
execSync('git add echo.js PHASE9.md', { cwd: repo, stdio: 'ignore' });
execSync('git commit -m init', { cwd: repo, stdio: 'ignore' });
writeFileSync(join(repo, 'PHASE10.md'), '# Phase 10 Smoke\n');
const terminals = new TerminalManager();
const { server, url } = await startServer({ store, terminals, port: 0 });
const BASE = url.replace(/\/$/, '');

const errors = [];
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1100, height: 800 } }).then((c) => c.newPage());
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/Failed to load resource: the server responded with a status of 400 \(Bad Request\)/.test(text)) return;
  errors.push('CONSOLE.ERROR: ' + text);
});

const ids = () => page.$$eval('.tile', (els) => els.map((e) => e.dataset.id));
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const box = (sel) => page.locator(sel).first().boundingBox();
async function responsiveSnapshot(width, height = 760) {
  await page.setViewportSize({ width, height });
  await sleep(150);
  return page.evaluate(() => {
    const rect = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const canvas = rect('#canvas');
    const minimap = rect('#minimap');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      topbar: rect('#topbar'),
      canvas,
      minimap,
      minimapDisplay: getComputedStyle(document.querySelector('#minimap')).display,
      dialog: document.querySelector('dialog[open]') ? rect('dialog[open]') : null,
    };
  });
}
const rectFitsViewport = (r, w, h) => r && r.x >= 0 && r.y >= 0 && r.right <= w && r.bottom <= h;

try {
  await page.goto(BASE + '/?xterm=0', { waitUntil: 'networkidle' }); // force the <pre> terminal for stable assertions
  await sleep(400);

  // First-run workspace creation: errors stay visible and a retry succeeds.
  check('first run opens the new-workspace dialog', await page.locator('#new-dialog[open]').count() === 1);
  check('repository path example is visible', /\/Users\/name\/project\/repo|C:\\Users\\name\\project\\repo/.test(await page.locator('#nw-path-example').textContent()));
  check('browser mode explains manual path paste', /Browser mode: paste the absolute path manually/.test(await page.locator('#nw-mode-note').textContent()));
  check('folder picker is disabled when no desktop bridge is present', await page.locator('#nw-browse').isDisabled());
  await page.click('#nw-create');
  await page.waitForFunction(() => /workspace name/i.test(document.querySelector('#nw-error')?.textContent || ''));
  check('empty workspace name shows inline validation', /workspace name/i.test(await page.locator('#nw-error').textContent()));
  check('empty workspace name focuses the name field', await page.evaluate(() => document.activeElement?.id === 'nw-name'));
  check('empty workspace name marks the name field invalid', await page.locator('#nw-name').getAttribute('aria-invalid') === 'true');
  await page.fill('#nw-name', 'Bad workspace');
  await page.click('#nw-create');
  await page.waitForFunction(() => /absolute path/i.test(document.querySelector('#nw-error')?.textContent || ''));
  check('empty repository path shows inline validation', /absolute path/i.test(await page.locator('#nw-error').textContent()));
  check('empty repository path focuses the repository field', await page.evaluate(() => document.activeElement?.id === 'nw-repo'));
  check('empty repository path marks the repository field invalid', await page.locator('#nw-repo').getAttribute('aria-invalid') === 'true');
  await page.fill('#nw-name', 'Bad workspace');
  await page.fill('#nw-repo', join(tmpdir(), 'codesurf-missing-repo'));
  await page.click('#nw-create');
  await page.locator('#nw-error').waitFor({ state: 'visible' });
  await page.waitForFunction(() => /repository path|folder|exist/i.test(document.querySelector('#nw-error')?.textContent || ''));
  check('invalid repository path keeps the dialog open', await page.locator('#new-dialog[open]').count() === 1);
  check('invalid repository path shows an actionable error', /folder not found|existing local folder/i.test(await page.locator('#nw-error').textContent()));
  check('invalid repository path uses a safe friendly message', !/codesurf-missing-repo/i.test(await page.locator('#nw-error').textContent()));
  check('invalid repository path preserves the user input', (await page.locator('#nw-repo').inputValue()) === join(tmpdir(), 'codesurf-missing-repo'));
  await page.fill('#nw-name', 'BrowserSmoke');
  await page.fill('#nw-repo', repo);
  let delayedCreate = false;
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() === 'POST' && !delayedCreate) {
      delayedCreate = true;
      await sleep(300);
    }
    await route.continue();
  });
  await page.click('#nw-create');
  await page.waitForFunction(() => document.querySelector('#nw-create')?.disabled);
  check('workspace create shows a submitting state', await page.locator('#nw-create').textContent() === 'Creating…');
  check('workspace create prevents duplicate submit clicks', await page.locator('#nw-create').isDisabled());
  check('workspace create disables cancel with an explicit reason', await page.locator('#nw-cancel').getAttribute('title') === 'Please wait while the workspace is created.');
  await page.locator('#new-dialog').waitFor({ state: 'hidden' });
  await page.unroute('**/api/workspaces');
  check('valid repository path creates and opens a workspace', (await page.locator('#workspace-select option').count()) === 1);
  const toolbarLabels = await page.$$eval('#topbar .toolbar-label', (els) => els.map((el) => el.textContent.trim()));
  check('toolbar is grouped into five visible task areas',
    ['Workspace', 'Create', 'View', 'Collaborate', 'Save'].every((label) => toolbarLabels.includes(label)));
  check('workspace select has a visible group label', toolbarLabels.includes('Workspace'));
  check('tile type select has a visible group label', toolbarLabels.includes('Create'));
  check('zoom status starts at 100 percent', (await page.locator('#zoom-status').textContent()) === '100%');
  await page.waitForFunction(() => /Contex: not started/.test(document.querySelector('#contex')?.textContent || ''));
  check('Contex local mode is explicit', /Contex: not started/.test(await page.locator('#contex').textContent()));
  check('Contex status explains how to enable agents', /--contex/.test(await page.locator('#contex-help').textContent()));
  check('save status uses text, not color alone', /Opened BrowserSmoke/.test(await page.locator('#status').textContent()));
  check('new empty workspace shows the getting-started guide', await page.locator('#empty-state:not([hidden])').count() === 1);
  check('getting-started guide explains four first steps', await page.locator('#empty-state .empty-steps li').count() === 4);
  check('getting-started guide offers a safe demo layout', await page.locator('#empty-demo-layout').count() === 1);
  await page.keyboard.press('?');
  check('question-mark shortcut opens canvas help', await page.locator('#help-dialog[open]').count() === 1);
  await page.keyboard.press('Escape');
  check('Escape closes canvas help', await page.locator('#help-dialog[open]').count() === 0);

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
  check('getting-started guide closes after adding a tile', await page.locator('#empty-state:not([hidden])').count() === 0);
  await page.waitForFunction(() => /Saving|Saved/.test(document.querySelector('#status')?.textContent || ''));
  check('save status reports saving or saved after a layout edit', /Saving|Saved/.test(await page.locator('#status').textContent()));
  check('tile header exposes a move hint', await page.locator(`.tile[data-id="${A}"] .head`).getAttribute('data-tip') === 'Drag header to move');
  check('tile port exposes a connect hint', await page.locator(`.tile[data-id="${A}"] .port`).getAttribute('data-tip') === 'Drag to connect');
  check('tile port has an accessible label', /Drag to another Tile/.test(await page.locator(`.tile[data-id="${A}"] .port`).getAttribute('aria-label')));
  check('tile context button has an accessible label', await page.locator(`.tile[data-id="${A}"] .btn.context`).getAttribute('aria-label') === 'Open Objective and Context');
  check('tile close button has an accessible label', await page.locator(`.tile[data-id="${A}"] .btn.close`).getAttribute('aria-label') === 'Delete Tile');
  await page.click(`.tile[data-id="${A}"] .btn.context`);
  await page.locator('#context-dialog[open]').waitFor({ state: 'visible' });
  check('context panel opens from a Tile header', await page.locator('#context-dialog[open]').count() === 1);
  check('context panel explains Contex offline mode', /Contex is not started/.test(await page.locator('#ctx-status').textContent()));
  check('context panel keeps local-canvas fallback explicit', /Local canvas still works/.test(await page.locator('#ctx-status').textContent()));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#context-dialog')?.open);
  check('Escape closes the context panel', await page.locator('#context-dialog[open]').count() === 0);
  const beforeShortcutTile = (await ids()).length;
  await page.keyboard.press('n'); await sleep(100);
  check('N shortcut adds a tile', (await ids()).length === beforeShortcutTile + 1);
  const S = await addTile('status');
  check('status tile renders task, Polly, and claim panels', await page.locator(`.tile[data-id="${S}"] .status-panel`).count() === 3);
  check('status tile has a manual refresh control', await page.locator(`.tile[data-id="${S}"] .status-refresh`).count() === 1);
  check('status tile explains offline partial state', /partial|0 active/.test(await page.locator(`.tile[data-id="${S}"] .status-summary`).textContent()));
  await page.click(`.tile[data-id="${S}"] .status-refresh`);
  await page.waitForFunction(() => /Contex is not started/.test(document.querySelector('.toast')?.textContent || ''));
  check('status tile refresh keeps Contex offline mode explicit', /Contex is not started/.test(await page.locator('.toast').textContent()));
  const G = await addTile('git');
  await dragFrom(`.tile[data-id="${G}"] .head`, -180, -40);
  await page.waitForFunction((id) => /main/.test(document.querySelector(`.tile[data-id="${id}"] .git-summary`)?.textContent || ''), G);
  check('git tile shows the current branch', /main/.test(await page.locator(`.tile[data-id="${G}"] .git-summary`).textContent()));
  check('git tile warns on protected branches', /Protected branch/.test(await page.locator(`.tile[data-id="${G}"] .git-warning`).textContent()));
  check('git tile lists dirty files', /PHASE10\.md/.test(await page.locator(`.tile[data-id="${G}"] .git-files`).textContent()));
  const M = await addTile('memory');
  await dragFrom(`.tile[data-id="${M}"] .head`, -180, 110);
  await page.click(`.tile[data-id="${M}"] .memory-propose`);
  await page.waitForFunction((id) => /Overview/.test(document.querySelector(`.tile[data-id="${id}"] .memory-sections`)?.textContent || ''), M);
  check('memory tile generates an evidence-backed proposal', /Overview/.test(await page.locator(`.tile[data-id="${M}"] .memory-sections`).textContent()));
  check('memory tile shows evidence chips', await page.locator(`.tile[data-id="${M}"] .memory-evidence span`).count() >= 2);
  await page.fill(`.tile[data-id="${M}"] .memory-pin-input`, 'CodeSurf browser smoke has a memory tile.');
  await page.click(`.tile[data-id="${M}"] .memory-add-pin`);
  await page.waitForFunction((id) => /browser smoke/.test(document.querySelector(`.tile[data-id="${id}"] .memory-pins`)?.textContent || ''), M);
  check('memory tile stores pinned facts', /browser smoke/.test(await page.locator(`.tile[data-id="${M}"] .memory-pins`).textContent()));
  await page.fill(`.tile[data-id="${M}"] .memory-marker-input`, 'Old local URL note is stale.');
  await page.click(`.tile[data-id="${M}"] .memory-add-stale`);
  await page.waitForFunction((id) => /stale/.test(document.querySelector(`.tile[data-id="${id}"] .memory-markers`)?.textContent || ''), M);
  check('memory tile stores stale markers', /stale/.test(await page.locator(`.tile[data-id="${M}"] .memory-markers`).textContent()));
  await page.click(`.tile[data-id="${M}"] .memory-accept`);
  await page.waitForFunction(() => /Workspace Memory accepted/.test(document.querySelector('.toast')?.textContent || ''));
  check('memory tile accepts a generated proposal', /Workspace Memory accepted/.test(await page.locator('.toast').textContent()));
  await page.click(`.tile[data-id="${M}"] .btn.close`, { force: true });
  await page.click(`.tile[data-id="${G}"] .btn.close`, { force: true });
  const BR = await addTile('browser');
  await dragFrom(`.tile[data-id="${BR}"] .head`, -260, -90);
  await page.fill(`.tile[data-id="${BR}"] .browser-url`, BASE + '/');
  await page.click(`.tile[data-id="${BR}"] .browser-go`);
  await page.waitForFunction((id) => /Loaded/.test(document.querySelector(`.tile[data-id="${id}"] .browser-console`)?.textContent || ''), BR);
  check('browser tile loads a local URL preview', /Loaded/.test(await page.locator(`.tile[data-id="${BR}"] .browser-console`).textContent()));
  await page.fill(`.tile[data-id="${BR}"] .browser-finding`, 'Toolbar renders without console errors.');
  await page.click(`.tile[data-id="${BR}"] .browser-send-finding`);
  await page.waitForFunction((id) => document.querySelectorAll(`.tile[data-id="${id}"] .finding`).length === 1, BR);
  check('browser tile stores a finding locally', await page.locator(`.tile[data-id="${BR}"] .finding`).count() === 1);
  const DOC = await addTile('document');
  await dragFrom(`.tile[data-id="${DOC}"] .head`, -260, 120);
  check('document tile starts as a markdown editor', await page.locator(`.tile[data-id="${DOC}"] .document-editor`).count() === 1);
  await page.click(`.tile[data-id="${DOC}"] .document-preset[data-preset="plan"]`);
  check('document tile inserts plan preset markdown', /# Plan/.test(await page.locator(`.tile[data-id="${DOC}"] .document-editor`).inputValue()));
  await page.fill(`.tile[data-id="${DOC}"] .document-comment`, 'Looks ready for QA handoff.');
  await page.click(`.tile[data-id="${DOC}"] .document-add-comment`);
  check('document tile records comments', await page.locator(`.tile[data-id="${DOC}"] .doc-comment`).count() === 1);
  await page.fill(`.tile[data-id="${DOC}"] .document-file`, 'PHASE9.md');
  await page.click(`.tile[data-id="${DOC}"] .document-load-file`);
  await page.waitForFunction((id) => /Phase 9 Smoke/.test(document.querySelector(`.tile[data-id="${id}"] .document-editor`)?.value || ''), DOC);
  check('document tile loads a repository file', /Phase 9 Smoke/.test(await page.locator(`.tile[data-id="${DOC}"] .document-editor`).inputValue()));
  await page.click(`.tile[data-id="${DOC}"] .document-toggle`);
  check('document tile renders markdown preview', /Phase 9 Smoke/.test(await page.locator(`.tile[data-id="${DOC}"] .document-preview`).textContent()));
  await page.click(`.tile[data-id="${BR}"] .btn.close`, { force: true });
  await page.click(`.tile[data-id="${DOC}"] .btn.close`, { force: true });
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const aB = await box(`.tile[data-id="${A}"]`), bB = await box(`.tile[data-id="${B}"]`);
  check('new tiles do not stack exactly', !(Math.abs(aB.x - bB.x) < 5 && Math.abs(aB.y - bB.y) < 5));

  await dragFrom(`.tile[data-id="${A}"] .head`, -340, -150);
  await dragFrom(`.tile[data-id="${B}"] .head`, 320, 160);
  await page.click('#fit'); await sleep(120);
  check('zoom status updates after fit', /%$/.test(await page.locator('#zoom-status').textContent()));
  await page.click('#reset-zoom'); await sleep(80);
  check('reset zoom restores the zoom status to 100 percent', (await page.locator('#zoom-status').textContent()) === '100%');

  await page.focus(`.tile[data-id="${A}"] .btn.min`);
  await page.keyboard.press('Enter'); await sleep(100);
  check('keyboard activation minimizes a tile', (await page.locator(`.tile[data-id="${A}"].minimized`).count()) === 1);
  await page.focus(`.tile[data-id="${A}"] .btn.min`);
  await page.keyboard.press('Enter'); await sleep(80);
  await page.focus(`.tile[data-id="${A}"] .btn.pin`);
  await page.keyboard.press('Enter'); await sleep(80);
  check('keyboard activation pins a tile', (await page.locator(`.tile[data-id="${A}"].pinned`).count()) === 1);
  await page.focus(`.tile[data-id="${A}"] .btn.pin`);
  await page.keyboard.press('Enter'); await sleep(80);

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
  check('port-drag link shows selected semantic label', /handoff/.test(await page.locator('#links text.link-label').first().textContent()));
  check('successful link shows feedback', /handoff link (created locally|syncing to Contex)/.test(await page.locator('.toast').textContent()));
  check('no temp link left after linking', (await page.locator('#links path.temp').count()) === 0);
  check('link drag selected no text', (await page.evaluate(() => window.getSelection().toString())).trim() === '');

  // head-drag across another tile's body must not select text either
  await dragFrom(`.tile[data-id="${A}"] .head`, 80, 30);
  check('tile drag selected no text', (await page.evaluate(() => window.getSelection().toString())).trim() === '');

  const p2 = center(await box(`.tile[data-id="${A}"] .port`));
  const canvasBox = await box('#canvas');
  const emptyDrop = { x: canvasBox.x + 40, y: canvasBox.y + canvasBox.height - 40 };
  await page.mouse.move(p2.x, p2.y); await page.mouse.down();
  await page.mouse.move(emptyDrop.x, emptyDrop.y, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => /Drop the port on another Tile/.test(document.querySelector('.toast')?.textContent || ''));
  check('dropping a link on empty canvas adds nothing', (await page.locator('#links path:not(.temp)').count()) === 1);
  check('empty link drop explains how to connect', /Drop the port on another Tile/.test(await page.locator('.toast').textContent()));
  check('no temp link left after empty drop', (await page.locator('#links path.temp').count()) === 0);

  await page.click(`.tile[data-id="${A}"] .btn.min`); await sleep(100);
  check('minimize toggles state', (await page.locator(`.tile[data-id="${A}"].minimized`).count()) === 1);
  await page.click(`.tile[data-id="${A}"] .btn.min`); await sleep(80);
  await page.click(`.tile[data-id="${A}"] .btn.pin`); await sleep(80);
  check('pin toggles state', (await page.locator(`.tile[data-id="${A}"].pinned`).count()) === 1);
  await page.click(`.tile[data-id="${A}"] .btn.pin`); await sleep(80);

  // terminal tile: run a real process, stream output, send stdin
  const T = await addTile('terminal');
  await dragFrom(`.tile[data-id="${T}"] .head`, -40, 240);
  const termOut = () => page.locator(`.tile[data-id="${T}"] .term-out`).textContent();
  await page.fill(`.tile[data-id="${T}"] .term-cmd`, 'node echo.js');
  await page.click(`.tile[data-id="${T}"] .term-start`);
  let dl = Date.now() + 5000, sawCard = false;
  while (Date.now() < dl) { if (/CARD=/.test(await termOut())) { sawCard = true; break; } await sleep(100); }
  check('terminal runs a process (CARD_ID injected, output streamed)', sawCard);
  await page.fill(`.tile[data-id="${T}"] .term-input`, 'ping');
  await page.press(`.tile[data-id="${T}"] .term-input`, 'Enter');
  dl = Date.now() + 5000; let sawEcho = false;
  while (Date.now() < dl) { if (/ECHO:ping/.test(await termOut())) { sawEcho = true; break; } await sleep(100); }
  check('terminal stdin is echoed back', sawEcho);
  await page.click(`.tile[data-id="${T}"] .btn.close`, { force: true }); await sleep(200); // stops process + removes tile

  const cnt = (await ids()).length;
  await page.click(`.tile[data-id="${B}"] .btn.close`, { force: true }); await sleep(150);
  check('close button deletes a tile', (await ids()).length === cnt - 1);
  check('delete action offers Undo', (await page.locator('#toast-action').count()) === 1);
  await page.click('#toast-action'); await sleep(150);
  check('Undo restores the deleted tile', (await ids()).length === cnt);

  await page.reload({ waitUntil: 'networkidle' }); await sleep(500);
  check('restored layout persists across reload (unload flush)', (await ids()).length === cnt);

  // Phase 2: first-use demo layout is safe, local, and discoverable.
  await page.evaluate(() => localStorage.removeItem('codesurf:emptyGuideDismissed'));
  await page.click('#new-workspace');
  await page.fill('#nw-name', 'BrowserDemo');
  await page.fill('#nw-repo', demoRepo);
  await page.click('#nw-create');
  await page.locator('#new-dialog').waitFor({ state: 'hidden' });
  await page.locator('#empty-state:not([hidden])').waitFor({ state: 'visible' });
  check('new demo workspace starts with the guide visible', await page.locator('#empty-state:not([hidden])').count() === 1);
  await page.click('#empty-demo-layout');
  await sleep(200);
  check('safe demo layout creates three local tiles', (await ids()).length === 3);
  check('safe demo layout links the example workflow', (await page.locator('#links path:not(.temp)').count()) === 2);
  check('safe demo layout closes the getting-started guide', await page.locator('#empty-state:not([hidden])').count() === 0);

  // Phase D: workflow presets create editable, non-autostarting Agent chains.
  await page.click('#new-workspace');
  await page.fill('#nw-name', 'BrowserWorkflow');
  await page.fill('#nw-repo', workflowRepo);
  await page.click('#nw-create');
  await page.locator('#new-dialog').waitFor({ state: 'hidden' });
  await page.click('#create-workflow');
  check('Workflow button opens preset dialog', await page.locator('#workflow-dialog[open]').count() === 1);
  check('workflow presets default to no auto-start', await page.locator('#workflow-auto-start').isChecked() === false);
  await page.click('#workflow-create');
  await page.locator('#workflow-dialog').waitFor({ state: 'hidden' });
  await sleep(250);
  check('workflow preset creates three Agent tiles', await page.locator('.tile .agent-tile').count() === 3);
  check('workflow preset creates directed links', await page.locator('#links path:not(.temp)').count() === 3);
  const workflowLabels = await page.$$eval('#links text.link-label', (els) => els.map((el) => el.textContent));
  check('workflow links show collaboration semantics', ['controls', 'handoff', 'reports to'].every((label) => workflowLabels.some((text) => text.includes(label))));
  const workflowTitles = await page.$$eval('.tile', (els) => els.map((el) => el.querySelector('.title')?.textContent || ''));
  const workflowLayout = await page.evaluate(async () => {
    const id = document.querySelector('#workspace-select').value;
    const res = await fetch(`/api/workspaces/${id}`);
    return (await res.json()).layout;
  });
  const workflowAgents = workflowLayout.tiles.filter((tile) => tile.type === 'agent');
  check('workflow Agents are titled by role', ['Coordinator Agent', 'Worker Agent', 'Reviewer Agent'].every((title) => workflowTitles.includes(title)));
  check('workflow Agents do not auto-start by default', workflowAgents.every((tile) => tile.data?.autostart === false && tile.data?.agentProfile?.auto_start === false));

  // Phase 2: users can dismiss the guide and the preference survives reload.
  await page.evaluate(() => localStorage.removeItem('codesurf:emptyGuideDismissed'));
  await page.click('#new-workspace');
  await page.fill('#nw-name', 'BrowserDismiss');
  await page.fill('#nw-repo', dismissRepo);
  await page.click('#nw-create');
  await page.locator('#new-dialog').waitFor({ state: 'hidden' });
  await page.locator('#empty-state:not([hidden])').waitFor({ state: 'visible' });
  check('dismiss test workspace starts with the guide visible', await page.locator('#empty-state:not([hidden])').count() === 1);
  await page.click('#empty-dismiss');
  await sleep(100);
  check('dismiss button hides the getting-started guide', await page.locator('#empty-state:not([hidden])').count() === 0);
  await page.reload({ waitUntil: 'networkidle' }); await sleep(500);
  check('dismissed getting-started guide stays hidden after reload', await page.locator('#empty-state:not([hidden])').count() === 0);

  // Phase 5: responsive and keyboard/a11y closeout.
  for (const width of [1280, 1024, 768]) {
    const snap = await responsiveSnapshot(width);
    check(`viewport ${width}px has no horizontal overflow`, snap.scrollWidth <= snap.viewport.width);
    check(`viewport ${width}px leaves room for the canvas`, snap.canvas.height > 300);
    check(`viewport ${width}px keeps the toolbar bounded`, snap.topbar.height < snap.viewport.height * 0.42);
    check(`viewport ${width}px keeps the minimap inside the canvas`, snap.minimapDisplay === 'none' ||
      (snap.minimap.x >= snap.canvas.x && snap.minimap.y >= snap.canvas.y &&
       snap.minimap.right <= snap.canvas.right && snap.minimap.bottom <= snap.canvas.bottom));
  }
  await page.setViewportSize({ width: 768, height: 760 });
  await page.click('#help');
  let snap = await responsiveSnapshot(768);
  check('help dialog fits within a 768px viewport', rectFitsViewport(snap.dialog, snap.viewport.width, snap.viewport.height));
  await page.keyboard.press('Escape');
  check('help dialog returns focus to its trigger', await page.evaluate(() => document.activeElement?.id === 'help'));
  await page.click('#new-workspace');
  snap = await responsiveSnapshot(768);
  check('new-workspace dialog fits within a 768px viewport', rectFitsViewport(snap.dialog, snap.viewport.width, snap.viewport.height));
  await page.keyboard.press('Escape');
  check('new-workspace dialog returns focus to its trigger', await page.evaluate(() => document.activeElement?.id === 'new-workspace'));
  const beforeKeyboardTile = (await ids()).length;
  await page.keyboard.press('n');
  await sleep(120);
  check('pure keyboard can create a tile after responsive checks', (await ids()).length === beforeKeyboardTile + 1);

  check('no console errors', errors.length === 0);
} finally {
  await browser.close();
  terminals.stopAll();
  server.close();
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'}  ${c.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) console.log('console/page errors:\n  ' + errors.join('\n  '));
process.exit(failed.length ? 1 : 0);
