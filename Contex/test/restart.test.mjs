import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createContex } from '../src/index.mjs';
import { activeClaimsForTile } from '../src/domain/tiles.mjs';

function cleanup(path) {
  for (const f of [path, `${path}-wal`, `${path}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

test('tile state, claims and links survive a service restart (SQLite recovery)', () => {
  const dbPath = join(tmpdir(), `contex-restart-${process.pid}-${performance.now().toString(36).replace('.', '')}.db`);
  cleanup(dbPath);
  try {
    // session 1: build up coordination state, then close
    let c = createContex({ dbPath });
    const ws = c.createWorkspace({ name: 'restart', repository_path: '/repo' });
    c.setState({ tile_id: 'term-a', tile_type: 'terminal', status: 'working', task: 'Build', files: [{ path: 'a.js', mode: 'exclusive' }] });
    c.setState({ tile_id: 'chat-b', tile_type: 'chat', status: 'idle' });
    c.linkTiles({ source_tile_id: 'term-a', target_tile_id: 'chat-b' });
    c.setState({ tile_id: 'term-a', status: 'working', task: 'Build more' }); // -> version 2
    c.close();

    // session 2: reopen the same db; everything should be there
    c = createContex({ dbPath });
    const sole = c.soleWorkspace();
    assert.equal(sole.id, ws.id);

    const tile = c.getTile('term-a');
    assert.equal(tile.reported_status, 'working');
    assert.equal(tile.task, 'Build more');
    assert.equal(tile.version, 2);

    assert.equal(activeClaimsForTile(c.db, 'term-a').length, 1);
    assert.equal(c.listLinks(ws.id).length, 1);

    // the peer graph still resolves after restart
    const view = c.getState({ tile_id: 'term-a' });
    assert.equal(view.peers.length, 1);
    assert.equal(view.peers[0].tile_id, 'chat-b');
    c.close();
  } finally {
    cleanup(dbPath);
  }
});
