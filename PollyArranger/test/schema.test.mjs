// Tests for registry validation (the invariants from docs/02 section 7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validateRegistry,
  assertValidRegistry,
  validateItem,
  BRANCH_RE,
} from '../src/registry/schema.mjs';
import { createEmptyRegistry } from '../src/registry/store.mjs';
import { STATES } from '../src/state-machine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, '..', 'examples', 'registry.example.json');

test('the shipped example registry is valid', () => {
  const reg = JSON.parse(readFileSync(examplePath, 'utf8'));
  const { ok, errors } = validateRegistry(reg);
  assert.ok(ok, `example should be valid, got:\n${errors.join('\n')}`);
});

test('an empty registry is valid', () => {
  assert.ok(validateRegistry(createEmptyRegistry()).ok);
});

test('implementer === reviewer is rejected (Polly core invariant)', () => {
  const errs = validateItem({
    id: 'p1', title: 't', status: STATES.PLANNED,
    implementer: 'codex', reviewer: 'codex',
  });
  assert.ok(errs.some((e) => /implementer and reviewer must differ/.test(e)));
});

test('a malformed branch name is rejected', () => {
  const errs = validateItem({ id: 'p1', title: 't', status: STATES.PLANNED, branch: 'feature/x' });
  assert.ok(errs.some((e) => /does not match/.test(e)));
  assert.ok(BRANCH_RE.test('polly/p8-github-stars'));
  assert.ok(!BRANCH_RE.test('polly/p8'));
});

test('a reviewing state without a PR is rejected', () => {
  const errs = validateItem({
    id: 'p1', title: 't', status: STATES.RE_REVIEW,
    branch: 'polly/p1-x', worktree: '.worktrees/p1-x', pr: null,
    implementer: 'claude_code', reviewer: 'codex',
  });
  assert.ok(errs.some((e) => /requires a pr/.test(e)));
});

test('assertValidRegistry throws on a bad registry', () => {
  const bad = createEmptyRegistry();
  bad.items.push({ id: 'p1', title: 't', status: 'NONSENSE' });
  assert.throws(() => assertValidRegistry(bad), /Invalid registry/);
});
