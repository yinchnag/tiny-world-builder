import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';
import { normalizeClaimPath } from '../src/domain/claims.mjs';
import { activeClaimsForTile } from '../src/domain/tiles.mjs';

test('claim paths normalize relative to the workspace repository', () => {
  assert.equal(normalizeClaimPath('/repo', 'engine/x.js'), 'engine/x.js');
  assert.equal(normalizeClaimPath('/repo', '/repo/engine/x.js'), 'engine/x.js');
  assert.equal(normalizeClaimPath('/repo/', 'a/../b.js'), 'b.js');
  assert.equal(normalizeClaimPath('C:\\repo', 'C:\\repo\\src\\a.js'), 'src/a.js');
  assert.equal(normalizeClaimPath(null, 'a.js'), 'a.js');
});

test('traversal and out-of-root paths are rejected', () => {
  assert.throws(() => normalizeClaimPath('/repo', '../secrets.txt'), (e) => e.code === ErrorCodes.BAD_REQUEST);
  assert.throws(() => normalizeClaimPath('/repo', 'a/../../etc/passwd'), (e) => e.code === ErrorCodes.BAD_REQUEST);
  assert.throws(() => normalizeClaimPath('/repo', '/etc/passwd'), (e) => e.code === ErrorCodes.BAD_REQUEST);
});

function fresh(opts) {
  const c = createContex(opts);
  c.createWorkspace({ name: 'test', repository_path: '/repo' });
  return c;
}

test('declaring an escaping path via peer_set_state is rejected and leaves no claim', () => {
  const c = fresh();
  assert.throws(
    () => c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: '../../etc/passwd', mode: 'edit' }] }),
    (e) => e.code === ErrorCodes.BAD_REQUEST,
  );
  assert.equal(activeClaimsForTile(c.db, 'a').length, 0);
  c.close();
});

test('declared claims are stored normalized', () => {
  const c = fresh();
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: '/repo/engine/world/30.js', mode: 'edit' }] });
  assert.equal(activeClaimsForTile(c.db, 'a')[0].path, 'engine/world/30.js');
  c.close();
});

test("an offline tile's claim does not create a conflict (stale)", () => {
  let t = 1_000_000;
  const c = createContex({ clock: () => t, heartbeatTimeoutMs: 30_000 });
  c.createWorkspace({ name: 'test', repository_path: '/repo' });
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] });
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  assert.equal(c.getState({ tile_id: 'a' }).conflicts.length, 1); // both online -> conflict
  t += 60_000; // b stops heartbeating; a refreshes by reading
  c.setState({ tile_id: 'a', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] }); // a stays alive
  const view = c.getState({ tile_id: 'a', include_offline: true });
  assert.equal(view.conflicts.length, 0); // b's claim is stale -> no conflict
  c.close();
});

test('an expired claim is ignored and can be purged', () => {
  let t = 1_000_000;
  const c = createContex({ clock: () => t });
  c.createWorkspace({ name: 'test', repository_path: '/repo' });
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] });
  const soon = new Date(t + 10_000).toISOString();
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit', expires_at: soon }] });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  assert.equal(c.getState({ tile_id: 'a' }).conflicts.length, 1);
  t += 20_000; // b's claim expired
  assert.equal(c.getState({ tile_id: 'a' }).conflicts.length, 0);
  assert.equal(c.purgeExpiredClaims(), 1);
  c.close();
});

test('conflict resolves after the claimant releases (self or owner override)', () => {
  const c = fresh();
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] });
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working', files: [{ path: 'x.js', mode: 'edit' }] });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  assert.equal(c.getState({ tile_id: 'a' }).conflicts.length, 1);
  // owner override releases b's claim
  assert.equal(c.releaseClaim({ tile_id: 'b', path: 'x.js' }), 1);
  assert.equal(c.getState({ tile_id: 'a' }).conflicts.length, 0);
  c.close();
});
