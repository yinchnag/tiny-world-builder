// Phase 0 smoke test — proves the harness runs and the example registry is valid.
// Real logic tests (state machine, store) arrive in Phase 1.
//
// Run: `npm test` (from PollyArranger/) — uses Node's built-in test runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

test('example registry is valid JSON', () => {
  const raw = readFileSync(join(root, 'examples', 'registry.example.json'), 'utf8');
  const reg = JSON.parse(raw);
  assert.equal(reg.version, 1);
  assert.ok(Array.isArray(reg.items) && reg.items.length > 0, 'has items');
});

test('example registry honors the core invariant: implementer !== reviewer', () => {
  // This is Polly's defining rule (docs/00 §2, docs/02 §7). Even before the
  // validator exists, the example must not violate it.
  const reg = JSON.parse(
    readFileSync(join(root, 'examples', 'registry.example.json'), 'utf8'),
  );
  for (const item of reg.items) {
    if (item.implementer && item.reviewer) {
      assert.notEqual(
        item.implementer,
        item.reviewer,
        `item ${item.id}: implementer and reviewer must differ`,
      );
    }
  }
});
