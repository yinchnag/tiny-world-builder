import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { deriveConflicts, availableToolsForType } from '../src/domain/peers.mjs';

function fresh() {
  const c = createContex();
  c.createWorkspace({ name: 'test' });
  return c;
}

test('available tools are derived from tile type', () => {
  assert.deepEqual(availableToolsForType('terminal'), ['terminal_send_input']);
  assert.deepEqual(availableToolsForType('chat'), ['chat_send_message', 'chat_acknowledge']);
  assert.deepEqual(availableToolsForType('document'), []);
});

test('peer discovery follows canvas links only', () => {
  const c = fresh();
  c.setState({ tile_id: 'term', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'chat', tile_type: 'chat', status: 'idle' });
  c.setState({ tile_id: 'lonely', tile_type: 'terminal', status: 'idle' });

  // before linking, term sees no peers
  assert.equal(c.getState({ tile_id: 'term' }).peers.length, 0);

  c.linkTiles({ source_tile_id: 'term', target_tile_id: 'chat' });
  const view = c.getState({ tile_id: 'term' });
  assert.equal(view.peers.length, 1);
  assert.equal(view.peers[0].tile_id, 'chat');
  assert.deepEqual(view.peers[0].available_tools, ['chat_send_message', 'chat_acknowledge']);

  // include_workspace is denied until the workspace opts in
  assert.throws(
    () => c.getState({ tile_id: 'term', include_workspace: true }),
    (e) => e.code === 'CONTEXT_SCOPE_DENIED',
  );
  c.setWorkspaceDiscovery(c.soleWorkspace().id, true);
  const all = c.getState({ tile_id: 'term', include_workspace: true });
  assert.equal(all.peers.length, 2);
  c.close();
});

test('deleting a link removes peer visibility', () => {
  const c = fresh();
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working' });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  assert.equal(c.getState({ tile_id: 'a' }).peers.length, 1);
  assert.equal(c.unlinkTiles({ source_tile_id: 'a', target_tile_id: 'b' }), true);
  assert.equal(c.getState({ tile_id: 'a' }).peers.length, 0);
  c.close();
});

test('terminal <-> terminal: undirected link lets both act on each other', () => {
  const c = fresh();
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working' });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  assert.deepEqual(c.getState({ tile_id: 'a' }).peers[0].available_tools, ['terminal_send_input']);
  assert.deepEqual(c.getState({ tile_id: 'b' }).peers[0].available_tools, ['terminal_send_input']);
  c.close();
});

test('directed link: tools flow one way, visibility stays both ways', () => {
  const c = fresh();
  c.setState({ tile_id: 'ctrl', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'sub', tile_type: 'terminal', status: 'working' });
  c.linkTiles({ source_tile_id: 'ctrl', target_tile_id: 'sub', kind: 'controls', directed: true });

  // ctrl can act on sub
  const ctrlView = c.getState({ tile_id: 'ctrl' });
  assert.equal(ctrlView.peers[0].tile_id, 'sub');
  assert.deepEqual(ctrlView.peers[0].available_tools, ['terminal_send_input']);

  // sub sees ctrl but cannot act on it (directed ctrl -> sub only)
  const subView = c.getState({ tile_id: 'sub' });
  assert.equal(subView.peers[0].tile_id, 'ctrl');
  assert.deepEqual(subView.peers[0].available_tools, []);
  c.close();
});

test('offline peers are hidden by default, shown with include_offline', () => {
  let t = 1_000_000;
  const c = createContex({ clock: () => t, heartbeatTimeoutMs: 30_000 });
  c.createWorkspace({ name: 'test' });
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working' });
  c.setState({ tile_id: 'b', tile_type: 'chat', status: 'idle' });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  t += 60_000; // b (and a) stop heartbeating
  assert.equal(c.getState({ tile_id: 'a' }).peers.length, 0);
  const withOffline = c.getState({ tile_id: 'a', include_offline: true });
  assert.equal(withOffline.peers.length, 1);
  assert.equal(withOffline.peers[0].online, false);
  c.close();
});

test('conflict matrix: edit/edit warns, exclusive blocks, read/read is silent', () => {
  // edit + edit on the same path -> warning
  assert.deepEqual(
    deriveConflicts([
      { tile_id: 'a', path: 'x.js', mode: 'edit' },
      { tile_id: 'b', path: 'x.js', mode: 'edit' },
    ]),
    [{ path: 'x.js', claimants: [{ tile_id: 'a', mode: 'edit' }, { tile_id: 'b', mode: 'edit' }], severity: 'warning', recommended_action: 'coordinate' }],
  );
  // exclusive present -> blocking
  assert.equal(deriveConflicts([
    { tile_id: 'a', path: 'x.js', mode: 'exclusive' },
    { tile_id: 'b', path: 'x.js', mode: 'read' },
  ])[0].severity, 'blocking');
  // read + edit -> info
  assert.equal(deriveConflicts([
    { tile_id: 'a', path: 'x.js', mode: 'read' },
    { tile_id: 'b', path: 'x.js', mode: 'edit' },
  ])[0].severity, 'info');
  // read + read -> no conflict
  assert.equal(deriveConflicts([
    { tile_id: 'a', path: 'x.js', mode: 'read' },
    { tile_id: 'b', path: 'x.js', mode: 'read' },
  ]).length, 0);
  // same tile twice on a path is not a conflict
  assert.equal(deriveConflicts([
    { tile_id: 'a', path: 'x.js', mode: 'edit' },
    { tile_id: 'a', path: 'x.js', mode: 'read' },
  ]).length, 0);
});

test('peer_get_state surfaces a real conflict between two linked editors', () => {
  const c = fresh();
  c.setState({ tile_id: 'a', tile_type: 'terminal', status: 'working', files: [{ path: 'engine/world/30.js', mode: 'edit' }] });
  c.setState({ tile_id: 'b', tile_type: 'terminal', status: 'working', files: [{ path: 'engine/world/30.js', mode: 'edit' }] });
  c.linkTiles({ source_tile_id: 'a', target_tile_id: 'b' });
  const view = c.getState({ tile_id: 'a' });
  assert.equal(view.conflicts.length, 1);
  assert.equal(view.conflicts[0].severity, 'warning');
  assert.equal(view.conflicts[0].path, 'engine/world/30.js');
  c.close();
});
