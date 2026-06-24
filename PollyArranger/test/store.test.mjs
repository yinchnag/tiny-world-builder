// Tests for the registry store — atomic, validated load/save round-trips.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createEmptyRegistry,
  saveRegistry,
  loadRegistry,
} from '../src/registry/store.mjs';
import { STATES } from '../src/state-machine.mjs';

function tmpRegistryPath() {
  const dir = mkdtempSync(join(tmpdir(), 'polly-store-'));
  return { dir, path: join(dir, 'registry.json') };
}

test('save then load round-trips the registry', () => {
  const { dir, path } = tmpRegistryPath();
  try {
    const reg = createEmptyRegistry();
    reg.items.push({
      id: 'p1', title: 'demo', status: STATES.PLANNED, reviewRound: 0,
    });
    saveRegistry(path, reg);
    assert.ok(existsSync(path), 'registry file should exist');

    const loaded = loadRegistry(path);
    assert.equal(loaded.items.length, 1);
    assert.equal(loaded.items[0].id, 'p1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveRegistry refuses to persist an invalid registry', () => {
  const { dir, path } = tmpRegistryPath();
  try {
    const reg = createEmptyRegistry();
    reg.items.push({ id: 'p1', title: 't', status: 'BOGUS' });
    assert.throws(() => saveRegistry(path, reg), /Invalid registry/);
    assert.ok(!existsSync(path), 'nothing should be written on invalid save');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
