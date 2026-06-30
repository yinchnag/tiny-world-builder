/**
 * runtime/persist/snapshot 单测 + F1 一致性冒烟：
 * restore + 增量重放 == 从 seq=0 全量重放。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from './sqlite-adapter';
import { append, head } from './event-log';
import { rebuild } from './projections/index';
import { nodesProjection } from './projections/nodes';
import { take, restoreAndReplay } from './snapshot';

describe('snapshot consistency (F1 smoke)', () => {
  it('restore + incremental replay equals full rebuild', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't1', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });

    // 在 seq=1 处取快照
    const snap = take(head(db), rebuild(db, nodesProjection));
    expect(snap.state).toEqual({ A: 'working' });

    // 快照之后再追加事件
    append(db, { ts: 't2', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'done' } });
    append(db, { ts: 't3', eventType: 'node.transitioned', nodeId: 'B', payload: { to: 'idle' } });

    const viaSnapshot = restoreAndReplay(db, nodesProjection, snap);
    const viaFull = rebuild(db, nodesProjection);
    expect(viaSnapshot).toEqual(viaFull);
    expect(viaFull).toEqual({ A: 'done', B: 'idle' });
  });
});
