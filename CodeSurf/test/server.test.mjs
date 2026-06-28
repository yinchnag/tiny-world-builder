import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { WorkspaceStore } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';

// raw HTTP request so we can set the forbidden `Host` header (fetch strips it)
function rawGet(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function tmp(p) { return mkdtempSync(join(tmpdir(), p)); }

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeGitRepo() {
  const dir = tmp('codesurf-git-repo-');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'codesurf@example.test']);
  git(dir, ['config', 'user.name', 'CodeSurf Test']);
  writeFileSync(join(dir, 'README.md'), '# Repo\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

let server, base, store, repo, port;

before(async () => {
  store = new WorkspaceStore(tmp('codesurf-srv-'));
  repo = tmp('codesurf-srv-repo-');
  const started = await startServer({ store, port: 0 });
  server = started.server;
  port = started.port;
  base = started.url.replace(/\/$/, '');
});

after(() => server?.close());

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('GET / serves the canvas shell HTML', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<title>CodeSurf<\/title>/);
  assert.match(html, /id="canvas"/);
});

test('static assets are served with correct content types', async () => {
  const js = await fetch(base + '/canvas.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const css = await fetch(base + '/style.css');
  assert.match(css.headers.get('content-type'), /text\/css/);
  // M3 tile module is served (not in any fixed allowlist — generic public serving)
  const tiles = await fetch(base + '/tiles.mjs');
  assert.equal(tiles.status, 200);
  assert.match(tiles.headers.get('content-type'), /javascript/);
  assert.match(await tiles.text(), /createDefaultRegistry/);
});

test('Codex agent runtime endpoint returns the local adapter command', async () => {
  const r = await call('GET', '/api/agent-runtimes/codex');
  assert.equal(r.status, 200);
  assert.equal(r.json.runtime, 'codex');
  assert.equal(r.json.command, process.execPath);
  assert.ok(Array.isArray(r.json.args));
  assert.match(r.json.script, /agent-runtime-codex\.mjs$/);
  assert.ok(!JSON.stringify(r.json).includes('CONTEX_TOKEN'));
});

test('path traversal outside public/ is rejected', async () => {
  // raw socket: fetch normalizes ../ away, so go low-level
  const res = await rawGet(port, '/../package.json', `127.0.0.1:${port}`);
  assert.ok(res.status === 403 || res.status === 404, `expected 403/404, got ${res.status}`);
  assert.ok(!/"name": "codesurf"/.test(res.body), 'must not leak package.json');
});

test('a missing static asset returns 404', async () => {
  const res = await fetch(base + '/nope.js');
  assert.equal(res.status, 404);
});

test('workspace create / list / open / save / close over HTTP', async () => {
  // initially empty
  let r = await call('GET', '/api/workspaces');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.workspaces, []);

  // create
  r = await call('POST', '/api/workspaces', { name: 'Net', repositoryPath: repo });
  assert.equal(r.status, 201);
  const id = r.json.id;
  assert.match(id, /^ws_/);

  // list now has it
  r = await call('GET', '/api/workspaces');
  assert.equal(r.json.workspaces.length, 1);

  // open (acquires lock) → empty layout
  r = await call('GET', `/api/workspaces/${id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.layout.tiles, []);
  assert.equal(r.json.recovered, false);

  // save a layout
  const layout = { viewport: { x: 5, y: 6, zoom: 1.25 },
                   tiles: [{ id: 'tile_x', type: 'note', x: 1, y: 2, w: 220, h: 140 }], links: [] };
  r = await call('PUT', `/api/workspaces/${id}/layout`, { layout });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  // close (release lock) then reopen → layout persisted
  r = await call('POST', `/api/workspaces/${id}/close`);
  assert.equal(r.json.ok, true);
  r = await call('GET', `/api/workspaces/${id}`);
  assert.equal(r.json.layout.tiles[0].id, 'tile_x');
  assert.equal(r.json.layout.viewport.zoom, 1.25);
  await call('POST', `/api/workspaces/${id}/close`);
});

test('workspace repository file endpoint reads only repo-relative files', async () => {
  writeFileSync(join(repo, 'PHASE9.md'), '# Phase 9\n\n- Browser tile\n');
  const created = await call('POST', '/api/workspaces', { name: 'Docs', repositoryPath: repo });
  const id = created.json.id;
  await call('GET', `/api/workspaces/${id}`);

  let r = await call('GET', `/api/workspaces/${id}/file?path=${encodeURIComponent('PHASE9.md')}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.path, 'PHASE9.md');
  assert.match(r.json.content, /Browser tile/);

  r = await call('GET', `/api/workspaces/${id}/file?path=${encodeURIComponent('/etc/passwd')}`);
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'CODESURF_BAD_REQUEST');

  r = await call('GET', `/api/workspaces/${id}/file?path=${encodeURIComponent('../outside.md')}`);
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'CODESURF_BAD_REQUEST');

  r = await call('GET', `/api/workspaces/${id}/file?path=${encodeURIComponent('missing.md')}`);
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'CODESURF_NOT_FOUND');
  await call('POST', `/api/workspaces/${id}/close`);
});

test('workspace git endpoints expose status and create explicit worktrees', async () => {
  const gitRepo = makeGitRepo();
  writeFileSync(join(gitRepo, 'README.md'), '# Repo\n\nchanged\n');
  const created = await call('POST', '/api/workspaces', { name: 'Git', repositoryPath: gitRepo });
  const id = created.json.id;
  await call('GET', `/api/workspaces/${id}`);

  let r = await call('GET', `/api/workspaces/${id}/git/status`);
  assert.equal(r.status, 200);
  assert.equal(r.json.branch.name, 'main');
  assert.equal(r.json.branch.protected, true);
  assert.equal(r.json.dirty, true);
  assert.equal(r.json.files[0].path, 'README.md');

  const wt = join(tmpdir(), 'codesurf-git-wt-' + Date.now());
  r = await call('POST', `/api/workspaces/${id}/git/worktrees`, { path: wt, branch: 'codex/phase-10-test' });
  assert.equal(r.status, 201);
  assert.equal(r.json.branch, 'codex/phase-10-test');

  r = await call('GET', `/api/workspaces/${id}/git/worktrees`);
  assert.equal(r.status, 200);
  assert.ok(r.json.worktrees.some((w) => w.branch === 'codex/phase-10-test'));

  r = await call('POST', `/api/workspaces/${id}/git/worktrees`, { path: 'relative/wt', branch: 'bad' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'CODESURF_BAD_REQUEST');
  await call('POST', `/api/workspaces/${id}/close`);
});

test('workspace memory endpoints generate redacted proposals and persist user facts', async () => {
  const gitRepo = makeGitRepo();
  writeFileSync(join(gitRepo, 'TODO.md'), 'Bearer should-not-leak\n');
  const created = await call('POST', '/api/workspaces', { name: 'Memory', repositoryPath: gitRepo });
  const id = created.json.id;
  await call('GET', `/api/workspaces/${id}`);
  await call('PUT', `/api/workspaces/${id}/layout`, {
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 },
      tiles: [{ id: 'tile_mem', type: 'document', title: 'Secret doc', x: 0, y: 0, w: 300, h: 220, data: { token: 'sk-1234567890abcdef', text: 'safe text' } }],
      links: [],
    },
  });

  let r = await call('POST', `/api/workspaces/${id}/memory/pins`, { text: 'API token sk-1234567890abcdef must not appear' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.json).includes('sk-1234567890abcdef'));
  assert.match(JSON.stringify(r.json), /\[redacted\]/);

  r = await call('POST', `/api/workspaces/${id}/memory/markers`, { kind: 'stale', text: 'Old deployment note is stale' });
  assert.equal(r.status, 200);
  assert.equal(r.json.memory.markers[0].kind, 'stale');

  r = await call('POST', `/api/workspaces/${id}/memory/proposal`, {});
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.proposal.sections));
  assert.ok(r.json.proposal.evidence.some((ev) => ev.kind === 'layout'));
  assert.ok(!JSON.stringify(r.json.proposal).includes('sk-1234567890abcdef'));

  r = await call('POST', `/api/workspaces/${id}/memory/accept`, { proposal: r.json.proposal });
  assert.equal(r.status, 200);
  assert.ok(r.json.memory.generated);

  r = await call('GET', `/api/workspaces/${id}/memory`);
  assert.equal(r.status, 200);
  assert.ok(r.json.memory.generated);
  assert.ok(r.json.memory.pins.length >= 1);
  await call('POST', `/api/workspaces/${id}/close`);
});

test('creating with a missing repo returns 400 with a code', async () => {
  const r = await call('POST', '/api/workspaces', { name: 'Bad', repositoryPath: join(tmpdir(), 'nope-xyz-123') });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'CODESURF_REPO_INVALID');
});

test('creating with missing workspace fields returns a useful 400 response', async () => {
  const noName = await call('POST', '/api/workspaces', { repositoryPath: repo });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.error.code, 'CODESURF_BAD_REQUEST');
  assert.match(noName.json.error.message, /name required/i);

  const noRepo = await call('POST', '/api/workspaces', { name: 'No repo' });
  assert.equal(noRepo.status, 400);
  assert.equal(noRepo.json.error.code, 'CODESURF_BAD_REQUEST');
  assert.match(noRepo.json.error.message, /repositoryPath required/i);
});

test('opening a held workspace from a second store returns 409', async () => {
  const r1 = await call('POST', '/api/workspaces', { name: 'Held', repositoryPath: repo });
  const id = r1.json.id;
  await call('GET', `/api/workspaces/${id}`); // server's store now holds the lock

  // a second independent store over the same data dir cannot open it
  const other = new WorkspaceStore(store.root);
  const started = await startServer({ store: other, port: 0 });
  try {
    const res = await fetch(started.url.replace(/\/$/, '') + `/api/workspaces/${id}`);
    assert.equal(res.status, 409);
    const j = await res.json();
    assert.equal(j.error.code, 'CODESURF_WORKSPACE_LOCKED');
  } finally {
    started.server.close();
  }
  await call('POST', `/api/workspaces/${id}/close`);
});

test('unknown workspace returns 404', async () => {
  const r = await call('GET', '/api/workspaces/ws_doesnotexist');
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'CODESURF_NOT_FOUND');
});

test('unknown route returns 404 json', async () => {
  const r = await call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'CODESURF_NOT_FOUND');
});

test('non-loopback Host header is rejected (DNS-rebinding guard)', async () => {
  const res = await rawGet(port, '/api/workspaces', 'evil.example.com');
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error.code, 'CODESURF_FORBIDDEN');
});

test('loopback Host header with port is accepted', async () => {
  const res = await rawGet(port, '/api/workspaces', `127.0.0.1:${port}`);
  assert.equal(res.status, 200);
});

test('invalid JSON body returns 400', async () => {
  const res = await fetch(base + '/api/workspaces', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json',
  });
  assert.equal(res.status, 400);
});
