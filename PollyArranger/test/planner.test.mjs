// Tests for the planner — seeding a backlog as PLANNED items.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyRegistry } from '../src/registry/store.mjs';
import { assertValidRegistry } from '../src/registry/schema.mjs';
import { seedItems, newPlannedItem } from '../src/planner.mjs';
import { STATES } from '../src/state-machine.mjs';

test('newPlannedItem produces a valid PLANNED item', () => {
  const item = newPlannedItem({ id: 'p1', title: 'X', spec: 'do x', wave: 'wave1' });
  assert.equal(item.status, STATES.PLANNED);
  assert.equal(item.wave, 'wave1');
  assert.equal(item.spec, 'do x');
  // a single-item registry with it should validate
  const reg = createEmptyRegistry();
  reg.items.push(item);
  assertValidRegistry(reg);
});

test('seedItems appends sequential ids and tags the wave', () => {
  const reg = createEmptyRegistry();
  const created = seedItems(reg, ['First', { title: 'Second', spec: 'do second' }], { wave: 'wave1' });
  assert.deepEqual(created.map((i) => i.id), ['p1', 'p2']);
  assert.equal(created[0].spec, 'First'); // string entry → title is spec
  assert.equal(created[1].spec, 'do second');
  assert.ok(created.every((i) => i.wave === 'wave1' && i.status === STATES.PLANNED));
  assertValidRegistry(reg);
});

test('seedItems continues numbering after existing ids', () => {
  const reg = createEmptyRegistry();
  seedItems(reg, ['a', 'b']); // p1, p2
  const more = seedItems(reg, ['c'], { wave: 'wave2' }); // p3
  assert.equal(more[0].id, 'p3');
  assert.equal(reg.items.length, 3);
});
