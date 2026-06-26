import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, emptyLayout, scrubSecrets, validateLayout } from '../src/store.mjs';
import { Codes } from '../src/errors.mjs';

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A repo path the store will accept (must exist and be a directory).
function fakeRepo() {
  const r = tmp('codesurf-repo-');
  return r;
}

test('round trip: create → save → close → reopen restores layout', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const repo = fakeRepo();
  const meta = store.createWorkspace({ name: 'Demo', repositoryPath: repo });
  assert.match(meta.id, /^ws_/);

  const opened = store.openWorkspace(meta.id);
  assert.deepEqual(opened.layout, emptyLayout());
  assert.equal(opened.recovered, false);

  const layout = {
    viewport: { x: 120, y: -40, zoom: 1.5 },
    tiles: [{ id: 'tile_a', type: 'terminal', x: 10, y: 20, w: 300, h: 200 }],
    links: [{ id: 'link_1', source: 'tile_a', target: 'tile_b', directed: true }],
  };
  store.saveLayout(meta.id, layout);
  store.closeWorkspace(meta.id);

  const reopened = store.openWorkspace(meta.id);
  assert.deepEqual(reopened.layout.viewport, { x: 120, y: -40, zoom: 1.5 });
  assert.equal(reopened.layout.tiles.length, 1);
  assert.equal(reopened.layout.tiles[0].id, 'tile_a');
  assert.equal(reopened.layout.schemaVersion, 1);
});

test('a fresh store + same-process reopen survives a simulated restart', () => {
  const root = tmp('codesurf-root-');
  const repo = fakeRepo();
  const s1 = new WorkspaceStore(root);
  const meta = s1.createWorkspace({ name: 'Persist', repositoryPath: repo });
  s1.openWorkspace(meta.id);
  s1.saveLayout(meta.id, { tiles: [{ id: 't1' }], links: [] });
  s1.closeWorkspace(meta.id);

  // brand new store object pointed at the same root = process restart
  const s2 = new WorkspaceStore(root);
  const list = s2.listWorkspaces();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, meta.id);
  const reopened = s2.openWorkspace(meta.id);
  assert.equal(reopened.layout.tiles[0].id, 't1');
});

test('createWorkspace rejects a missing repository path', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  assert.throws(
    () => store.createWorkspace({ name: 'Bad', repositoryPath: join(tmpdir(), 'definitely-not-here-xyz') }),
    (e) => e.code === Codes.REPO_INVALID,
  );
});

test('createWorkspace rejects missing name / repo args', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  assert.throws(() => store.createWorkspace({ repositoryPath: fakeRepo() }), (e) => e.code === Codes.BAD_REQUEST);
  assert.throws(() => store.createWorkspace({ name: 'x' }), (e) => e.code === Codes.BAD_REQUEST);
});

test('simultaneous open is prevented while held, allowed after close', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'Lock', repositoryPath: fakeRepo() });
  store.openWorkspace(meta.id);

  // a second store in the SAME process simulates a second window; the lock
  // names our live pid, so it must refuse.
  const other = new WorkspaceStore(store.root);
  assert.throws(() => other.openWorkspace(meta.id), (e) => e.code === Codes.WORKSPACE_LOCKED);

  store.closeWorkspace(meta.id);
  // now it opens
  const ok = other.openWorkspace(meta.id);
  assert.ok(ok.meta.id === meta.id);
  other.closeWorkspace(meta.id);
});

test('re-opening from the SAME store is idempotent (no lock error)', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'Reopen', repositoryPath: fakeRepo() });
  store.openWorkspace(meta.id);
  store.saveLayout(meta.id, { tiles: [{ id: 'keep' }], links: [] });
  // a second open from the same store must not throw and must see saved state
  const again = store.openWorkspace(meta.id);
  assert.equal(again.layout.tiles[0].id, 'keep');
  store.closeWorkspace(meta.id);
});

test('a stale lock from a dead pid is stolen, not honored', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'Stale', repositoryPath: fakeRepo() });
  // forge a lock owned by a pid that cannot exist
  const lockPath = join(store.root, meta.id, 'workspace.lock');
  writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 30, host: hostname(), at: new Date().toISOString() }));
  const opened = store.openWorkspace(meta.id); // should steal the stale lock
  assert.equal(opened.meta.id, meta.id);
  store.closeWorkspace(meta.id);
});

test('corrupted layout recovers from the .bak backup', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'Recover', repositoryPath: fakeRepo() });
  store.openWorkspace(meta.id);

  // good save → produces layout.json; second save rotates first to .bak
  store.saveLayout(meta.id, { tiles: [{ id: 'good' }], links: [] });
  store.saveLayout(meta.id, { tiles: [{ id: 'newer' }], links: [] });
  store.closeWorkspace(meta.id);

  // corrupt the primary layout file
  const layoutPath = join(store.root, meta.id, 'layout.json');
  writeFileSync(layoutPath, '{ this is not json');

  const reopened = store.openWorkspace(meta.id);
  assert.equal(reopened.recovered, true);
  // .bak held the FIRST save ("good"), so recovery yields that
  assert.equal(reopened.layout.tiles[0].id, 'good');
  // the corrupt primary was quarantined
  assert.ok(existsSync(layoutPath + '.corrupt'));
});

test('corrupted layout with no backup resets to an empty flagged layout', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'NoBak', repositoryPath: fakeRepo() });
  const layoutPath = join(store.root, meta.id, 'layout.json');
  writeFileSync(layoutPath, 'garbage');
  const reopened = store.openWorkspace(meta.id);
  assert.deepEqual(reopened.layout.tiles, []);
  assert.equal(reopened.recovered, true);
});

test('export strips secrets and is portable', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const meta = store.createWorkspace({ name: 'Export', repositoryPath: fakeRepo() });
  store.openWorkspace(meta.id);
  store.saveLayout(meta.id, {
    tiles: [{
      id: 't1', type: 'terminal',
      env: { CONTEX_TOKEN: 'super-secret' },
      headers: { authorization: 'Bearer abc' },
      command: 'claude',
    }],
    links: [],
  });
  const bundle = store.exportWorkspace(meta.id);
  const json = JSON.stringify(bundle);
  assert.ok(!json.includes('super-secret'));
  assert.ok(!json.includes('Bearer abc'));
  // non-secret fields survive
  assert.equal(bundle.layout.tiles[0].command, 'claude');
  assert.equal(bundle.meta.name, 'Export');
});

test('listWorkspaces hides archived by default, shows them on request', () => {
  const store = new WorkspaceStore(tmp('codesurf-root-'));
  const a = store.createWorkspace({ name: 'A', repositoryPath: fakeRepo() });
  store.createWorkspace({ name: 'B', repositoryPath: fakeRepo() });
  store.archiveWorkspace(a.id);
  assert.equal(store.listWorkspaces().length, 1);
  assert.equal(store.listWorkspaces({ includeArchived: true }).length, 2);
});

test('scrubSecrets is recursive and non-mutating', () => {
  const input = { a: 1, token: 'x', nested: [{ password: 'p', keep: 2 }] };
  const out = scrubSecrets(input);
  assert.deepEqual(out, { a: 1, nested: [{ keep: 2 }] });
  assert.equal(input.token, 'x'); // original untouched
});

test('validateLayout rejects non-array tiles/links and coerces viewport', () => {
  assert.throws(() => validateLayout({ tiles: 'no', links: [] }), (e) => e.code === Codes.BAD_REQUEST);
  const v = validateLayout({ tiles: [], links: [], viewport: { x: 'nope', y: 5 } });
  assert.equal(v.viewport.x, 0);
  assert.equal(v.viewport.y, 5);
  assert.equal(v.viewport.zoom, 1);
});
