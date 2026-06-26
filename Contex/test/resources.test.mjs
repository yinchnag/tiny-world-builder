import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { listResources, readResource } from '../src/resources.mjs';

function fresh() {
  const c = createContex();
  const ws = c.createWorkspace({ name: 'test', repository_path: '/repo' });
  c.setState({ tile_id: 'term', tile_type: 'terminal', status: 'working', files: [{ path: 'a.js', mode: 'edit' }] });
  c.setState({ tile_id: 'chat', tile_type: 'chat', status: 'idle' });
  c.linkTiles({ source_tile_id: 'term', target_tile_id: 'chat' });
  return { c, ws };
}

test('resources/list advertises workspace + per-tile views', () => {
  const { c, ws } = fresh();
  const uris = listResources(c).map((r) => r.uri);
  assert.ok(uris.includes(`context://workspace/${ws.id}`));
  assert.ok(uris.includes(`context://workspace/${ws.id}/graph`));
  assert.ok(uris.includes('context://tile/term/state'));
  assert.ok(uris.includes('context://tile/term/peers'));
  c.close();
});

test('workspace resource exposes metadata + active tile count', () => {
  const { c, ws } = fresh();
  const r = readResource(c, `context://workspace/${ws.id}`);
  assert.equal(r.mimeType, 'application/json');
  const data = JSON.parse(r.text);
  assert.equal(data.id, ws.id);
  assert.equal(data.repository_path, '/repo');
  assert.equal(data.active_tile_count, 2);
  c.close();
});

test('graph resource lists tiles as nodes and links as edges', () => {
  const { c, ws } = fresh();
  const data = JSON.parse(readResource(c, `context://workspace/${ws.id}/graph`).text);
  assert.equal(data.nodes.length, 2);
  assert.equal(data.edges.length, 1);
  assert.deepEqual(
    { source: data.edges[0].source, target: data.edges[0].target },
    { source: 'term', target: 'chat' },
  );
  c.close();
});

test('tasks resource lists tasks and todos for the workspace', () => {
  const { c, ws } = fresh();
  c.createTask({ title: 'a task', channel: 'term' });
  c.addTodo({ creator_tile_id: 'term', assignee_tile_id: 'chat', title: 'a todo' });
  const data = JSON.parse(readResource(c, `context://workspace/${ws.id}/tasks`).text);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, 'a task');
  assert.equal(data.todos.length, 1);
  c.close();
});

test('tile state resource includes status and active claims', () => {
  const { c } = fresh();
  const data = JSON.parse(readResource(c, 'context://tile/term/state').text);
  assert.equal(data.tile_id, 'term');
  assert.equal(data.status, 'working');
  assert.deepEqual(data.claims, [{ path: 'a.js', mode: 'edit', section: null }]);
  c.close();
});

test('peers resource renders the historical peers.md format', () => {
  const { c } = fresh();
  const md = readResource(c, 'context://tile/term/peers').text;
  assert.match(md, /# Peers for term/);
  assert.match(md, /- chat \(chat\)/);
  assert.match(md, /tools: chat_send_message, chat_acknowledge/);
  assert.match(md, /regenerated when links change/);
  c.close();
});

test('inbox resource returns recent messages for a tile', () => {
  const { c } = fresh();
  c.chatSendMessage({ from_tile_id: 'term', to_tile_id: 'chat', text: 'hello inbox' });
  const data = JSON.parse(readResource(c, 'context://tile/chat/inbox').text);
  assert.equal(data.tile_id, 'chat');
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].text, 'hello inbox');
  c.close();
});

test('unknown tile / bad uri are rejected', () => {
  const { c } = fresh();
  assert.throws(() => readResource(c, 'context://tile/nope/state'), (e) => e.code === 'CONTEXT_TILE_NOT_FOUND');
  assert.throws(() => readResource(c, 'context://bogus/x'), (e) => e.code === 'CONTEXT_BAD_REQUEST');
  c.close();
});
