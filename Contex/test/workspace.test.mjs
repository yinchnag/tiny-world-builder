import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';

test('workspaces can be created, listed, and archived', () => {
  const c = createContex();
  const a = c.createWorkspace({ name: 'alpha', repository_path: '/a' });
  const b = c.createWorkspace({ name: 'beta', repository_path: '/b' });

  assert.equal(c.listWorkspaces().length, 2);
  // two workspaces -> no single default
  assert.equal(c.soleWorkspace(), null);

  const archived = c.archiveWorkspace(a.id);
  assert.ok(archived.archived_at);
  assert.equal(c.listWorkspaces().length, 1);
  assert.equal(c.listWorkspaces({ includeArchived: true }).length, 2);
  // archiving down to one restores a sole default
  assert.equal(c.soleWorkspace().id, b.id);
  c.close();
});

test('archiving an unknown workspace returns null', () => {
  const c = createContex();
  assert.equal(c.archiveWorkspace('ws_missing'), null);
  c.close();
});
