/**
 * runtime/mcp/resources 单测：读投影视图（graph/timeline）。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../persist/sqlite-adapter';
import { append } from '../persist/event-log';
import { readResource } from './resources';

describe('readResource', () => {
  it('reads the graph projection view', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't1', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });
    const r = readResource(db, 'context://ws/graph');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ nodes: { A: 'working' } });
  });

  it('rejects an unknown view / bad uri', () => {
    const db = openDb();
    migrate(db);
    expect(readResource(db, 'context://ws/nope').ok).toBe(false);
    expect(readResource(db, 'not-a-uri').ok).toBe(false);
  });
});
