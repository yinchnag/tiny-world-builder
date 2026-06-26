import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';
import { isValidTaskTransition } from '../src/domain/tasks.mjs';

function fresh() {
  const c = createContex();
  c.createWorkspace({ name: 'test' });
  return c;
}

test('a task starts open and walks the happy path to done', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Ship settings panel', channel: 'term-a' });
  assert.equal(t.status, 'open');
  assert.equal(t.version, 1);
  assert.equal(c.updateTask({ task_id: t.id, status: 'assigned', owner_tile_id: 'term-a' }).status, 'assigned');
  assert.equal(c.updateTask({ task_id: t.id, status: 'in_progress' }).status, 'in_progress');
  assert.equal(c.updateTask({ task_id: t.id, status: 'review' }).status, 'review');
  const done = c.updateTask({ task_id: t.id, status: 'done', result_summary: 'shipped' });
  assert.equal(done.status, 'done');
  assert.ok(done.completed_at);
  assert.equal(done.result_summary, 'shipped');
  c.close();
});

test('invalid transitions are rejected', () => {
  const c = fresh();
  const t = c.createTask({ title: 'x' });
  // open -> done is not allowed
  assert.throws(() => c.updateTask({ task_id: t.id, status: 'done' }), (e) => e.code === ErrorCodes.INVALID_TRANSITION);
  c.close();
});

test('transition table sanity', () => {
  assert.equal(isValidTaskTransition('open', 'assigned'), true);
  assert.equal(isValidTaskTransition('in_progress', 'review'), true);
  assert.equal(isValidTaskTransition('review', 'done'), true);
  assert.equal(isValidTaskTransition('open', 'done'), false);
  assert.equal(isValidTaskTransition('done', 'in_progress'), false);
});

test('optimistic concurrency on concurrent task updates', () => {
  const c = fresh();
  const t = c.createTask({ title: 'x' });
  c.updateTask({ task_id: t.id, status: 'assigned', expected_version: 1 });
  // a second updater holding the stale version is rejected
  assert.throws(
    () => c.updateTask({ task_id: t.id, status: 'cancelled', expected_version: 1 }),
    (e) => e.code === ErrorCodes.VERSION_CONFLICT,
  );
  c.close();
});

test('pause stores a reason and resume clears the blocker', () => {
  const c = fresh();
  const t = c.createTask({ title: 'x' });
  c.updateTask({ task_id: t.id, status: 'assigned' });
  c.updateTask({ task_id: t.id, status: 'in_progress' });
  const paused = c.pauseTask({ task_id: t.id, reason: 'waiting on review' });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.blocker, 'waiting on review');
  const resumed = c.updateTask({ task_id: t.id, status: 'in_progress' });
  assert.equal(resumed.blocker, null);
  c.close();
});

test('a task can be assigned to an offline (or not-yet-registered) tile', () => {
  const c = fresh();
  const t = c.createTask({ title: 'x' });
  // owner tile has never registered — assignment still works
  const assigned = c.updateTask({ task_id: t.id, status: 'assigned', owner_tile_id: 'ghost-tile' });
  assert.equal(assigned.owner_tile_id, 'ghost-tile');
  c.close();
});

test('tasks are visible per channel', () => {
  const c = fresh();
  c.createTask({ title: 'a', channel: 'chan-1' });
  c.createTask({ title: 'b', channel: 'chan-2' });
  c.createTask({ title: 'c', channel: 'chan-1' });
  const ws = c.soleWorkspace().id;
  assert.equal(c.listTasks(ws).length, 3);
  assert.equal(c.listTasks(ws, { channel: 'chan-1' }).length, 2);
  c.close();
});

test('a recovered state.json imports and shows up in the tasks resource', () => {
  const c = fresh();
  const state = { tasks: [{ title: 'recovered task' }], paused: false };
  assert.equal(c.importTaskState({ channel: 'tile-1779176041759', state }), 1);
  const ws = c.soleWorkspace().id;
  assert.equal(c.listTasks(ws).length, 1);
  assert.equal(c.listTasks(ws)[0].title, 'recovered task');
  c.close();
});
