/**
 * runtime/persist/projections 单测：rebuild 从事件全量重放。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../sqlite-adapter';
import { append } from '../event-log';
import { rebuild } from './index';
import { nodesProjection } from './nodes';

describe('rebuild', () => {
  it('projects node states by replaying events from seq 0', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't1', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });
    append(db, { ts: 't2', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'done' } });
    append(db, { ts: 't3', eventType: 'node.transitioned', nodeId: 'B', payload: { to: 'idle' } });
    expect(rebuild(db, nodesProjection)).toEqual({ A: 'done', B: 'idle' });
  });

  it('same event sequence rebuilds to the same state (purity)', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't1', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });
    expect(rebuild(db, nodesProjection)).toEqual(rebuild(db, nodesProjection));
  });
});
