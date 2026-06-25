// Tests for the wave/status reporter (derived views).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyRegistry } from '../src/registry/store.mjs';
import { statusCounts, waveProgress, waveIds, formatReport } from '../src/report.mjs';
import { STATES } from '../src/state-machine.mjs';

function reg() {
  const r = createEmptyRegistry();
  r.items.push(
    { id: 'p1', title: 'a', status: STATES.MERGED, wave: 'wave1' },
    { id: 'p2', title: 'b', status: STATES.MERGED, wave: 'wave1' },
    { id: 'p3', title: 'c', status: STATES.IN_REVIEW, wave: 'wave1' },
    { id: 'p4', title: 'd', status: STATES.BLOCKED, wave: 'wave1' },
    { id: 'p5', title: 'e', status: STATES.PLANNED, wave: 'wave2' },
  );
  return r;
}

test('statusCounts tallies by status', () => {
  const c = statusCounts(reg().items);
  assert.equal(c[STATES.MERGED], 2);
  assert.equal(c[STATES.IN_REVIEW], 1);
  assert.equal(c[STATES.BLOCKED], 1);
  assert.equal(c[STATES.PLANNED], 1);
});

test('waveProgress reports per-wave totals and merged count', () => {
  const p = waveProgress(reg(), 'wave1');
  assert.equal(p.total, 4);
  assert.equal(p.merged, 2);
  assert.equal(p.byStatus[STATES.IN_REVIEW], 1);
});

test('waveIds lists every distinct wave', () => {
  assert.deepEqual(waveIds(reg()).sort(), ['wave1', 'wave2']);
});

test('formatReport renders one line per wave', () => {
  const out = formatReport(reg());
  assert.match(out, /wave1: 2\/4 merged/);
  assert.match(out, /wave2: 0\/1 merged/);
});
