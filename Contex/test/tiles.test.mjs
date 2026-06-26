import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';
import { isValidTransition, activeClaimsForTile } from '../src/domain/tiles.mjs';

function fresh(opts = {}) {
  const c = createContex(opts);
  c.createWorkspace({ name: 'test', repository_path: '/repo' });
  return c;
}

test('register creates a v1 idle tile', () => {
  const c = fresh();
  const t = c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'idle', task: 'Ready' });
  assert.equal(t.tile_id, 'tile-1');
  assert.equal(t.status, 'idle');
  assert.equal(t.version, 1);
  assert.equal(t.online, true);
  c.close();
});

test('registering directly into a terminal status is rejected', () => {
  const c = fresh();
  assert.throws(
    () => c.setState({ tile_id: 'tile-x', tile_type: 'terminal', status: 'done' }),
    (e) => e.code === ErrorCodes.INVALID_TRANSITION,
  );
  c.close();
});

test('version increments and optimistic concurrency is enforced', () => {
  const c = fresh();
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'idle' });
  const v2 = c.setState({ tile_id: 'tile-1', status: 'working', task: 'Build', expected_version: 1 });
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'working');
  // stale expected_version is rejected
  assert.throws(
    () => c.setState({ tile_id: 'tile-1', status: 'done', expected_version: 1 }),
    (e) => e.code === ErrorCodes.VERSION_CONFLICT,
  );
  c.close();
});

test('illegal status transition is rejected', () => {
  const c = fresh();
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'tile-1', status: 'done' });
  // done -> waiting is not allowed by the state machine
  assert.throws(
    () => c.setState({ tile_id: 'tile-1', status: 'waiting' }),
    (e) => e.code === ErrorCodes.INVALID_TRANSITION,
  );
  c.close();
});

test('transition table sanity', () => {
  assert.equal(isValidTransition('offline', 'idle'), true);
  assert.equal(isValidTransition('working', 'done'), true);
  assert.equal(isValidTransition('done', 'waiting'), false);
  assert.equal(isValidTransition('idle', 'bogus'), false);
});

test('files[] declare and replace claims', () => {
  const c = fresh();
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'working', files: [{ path: 'a.js', mode: 'edit' }, { path: 'b.js', mode: 'read' }] });
  let claims = activeClaimsForTile(c.db, 'tile-1');
  assert.equal(claims.length, 2);
  // re-declaring replaces the previous set
  c.setState({ tile_id: 'tile-1', status: 'working', files: [{ path: 'a.js', mode: 'exclusive' }] });
  claims = activeClaimsForTile(c.db, 'tile-1');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].mode, 'exclusive');
  // explicit empty array releases all
  c.setState({ tile_id: 'tile-1', status: 'idle', files: [] });
  assert.equal(activeClaimsForTile(c.db, 'tile-1').length, 0);
  c.close();
});

test('done -> working starts a new task (DATA_MODEL transition)', () => {
  const c = fresh();
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'working', task: 'First' });
  c.setState({ tile_id: 'tile-1', status: 'done', summary: 'shipped' });
  const reopened = c.setState({ tile_id: 'tile-1', status: 'working', task: 'Second' });
  assert.equal(reopened.status, 'working');
  assert.equal(reopened.task, 'Second');
  c.close();
});

test('reconnect with a new client_instance_id preserves state and is audited', () => {
  const c = fresh();
  const ws = c.soleWorkspace();
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'working', task: 'Build', client_instance_id: 'pid-1' });
  c.setState({ tile_id: 'tile-1', status: 'working', client_instance_id: 'pid-2' }); // agent process restarted
  const t = c.getTile('tile-1');
  assert.equal(t.task, 'Build'); // prior state preserved across reconnect
  const events = c.listAudit(ws.id).map((e) => e.event_type);
  assert.ok(events.includes('tile_reconnected'));
  c.close();
});

test('a tile goes offline after the heartbeat timeout (clock-driven)', () => {
  let t = 1_000_000;
  const c = fresh({ clock: () => t, heartbeatTimeoutMs: 30_000 });
  c.setState({ tile_id: 'tile-1', tile_type: 'terminal', status: 'working' });
  assert.equal(c.getTile('tile-1').online, true);
  t += 60_000; // exceed the timeout without a heartbeat
  const stale = c.getTile('tile-1');
  assert.equal(stale.online, false);
  assert.equal(stale.status, 'offline');
  assert.equal(stale.reported_status, 'working'); // last report preserved
  c.close();
});
