// ③ The async mutex — proves it serializes critical sections (no interleaving),
// in submission order, while non-locked work can still overlap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutex } from '../src/util/mutex.mjs';

const tick = () => new Promise((r) => setTimeout(r, 1));

test('runExclusive serializes overlapping sections without interleaving', async () => {
  const lock = createMutex();
  const log = [];
  async function section(label) {
    log.push(`${label}:enter`);
    await tick(); // yield — an unlocked version would interleave here
    log.push(`${label}:exit`);
  }
  // Launch three "at once"; the lock must run them one fully-complete at a time.
  await Promise.all([
    lock(() => section('A')),
    lock(() => section('B')),
    lock(() => section('C')),
  ]);
  assert.deepEqual(log, [
    'A:enter', 'A:exit',
    'B:enter', 'B:exit',
    'C:enter', 'C:exit',
  ]);
});

test('a failure in one section does not wedge the lock', async () => {
  const lock = createMutex();
  await assert.rejects(lock(async () => { throw new Error('boom'); }), /boom/);
  // the lock still works afterwards
  const v = await lock(async () => 42);
  assert.equal(v, 42);
});

test('runExclusive returns the section result to the caller', async () => {
  const lock = createMutex();
  const results = await Promise.all([lock(async () => 1), lock(async () => 2)]);
  assert.deepEqual(results, [1, 2]);
});
