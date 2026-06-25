// Tests for the CLI's pure helpers (ⓠ). The full `run` path needs real git +
// API keys and is exercised by the demos, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, loadBacklog } from '../src/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('parseArgs reads the command, --key value pairs, and --flags', () => {
  const o = parseArgs(['run', '--repo', '/x', '--backlog', 'b.json', '--concurrency', '2', '--local-pr']);
  assert.equal(o.command, 'run');
  assert.equal(o.repo, '/x');
  assert.equal(o.backlog, 'b.json');
  assert.equal(o.concurrency, '2');
  assert.equal(o['local-pr'], true);
});

test('parseArgs handles a bare command', () => {
  assert.deepEqual(parseArgs(['status']), { command: 'status' });
  assert.deepEqual(parseArgs([]), { command: undefined });
});

test('loadBacklog reads a JSON array file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polly-cli-'));
  try {
    const file = join(dir, 'b.json');
    writeFileSync(file, JSON.stringify(['a task', { title: 'T', spec: 'do T' }]));
    const entries = loadBacklog({ backlog: file });
    assert.equal(entries.length, 2);
    assert.equal(entries[1].title, 'T');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadBacklog turns --spec into a single entry', () => {
  const entries = loadBacklog({ spec: 'add a hello banner' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].spec, 'add a hello banner');
  assert.ok(entries[0].title.length > 0);
});

test('loadBacklog throws when neither --backlog nor --spec is given', () => {
  assert.throws(() => loadBacklog({}), /--backlog|--spec/);
});

test('the example backlog file parses as a valid backlog', () => {
  // examples/backlog.example.json should be usable as-is.
  const entries = loadBacklog({ backlog: join(here, '..', 'examples', 'backlog.example.json') });
  assert.ok(entries.length >= 2);
});
