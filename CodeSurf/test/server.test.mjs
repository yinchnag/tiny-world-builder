import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
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

test('creating with a missing repo returns 400 with a code', async () => {
  const r = await call('POST', '/api/workspaces', { name: 'Bad', repositoryPath: join(tmpdir(), 'nope-xyz-123') });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'CODESURF_REPO_INVALID');
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
