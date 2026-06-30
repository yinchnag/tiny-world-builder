/**
 * runtime/persist/event-log 单测：自增 seq · 顺序读 · 不可变（只追加）· payload 往返。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type Db } from './sqlite-adapter';
import { append, scan, head } from './event-log';

let db: Db;
beforeEach(() => {
  db = openDb();
  migrate(db);
});

describe('event-log', () => {
  it('appends with strictly incrementing seq', () => {
    expect(append(db, { ts: 't1', eventType: 'message.sent' }).seq).toBe(1);
    expect(append(db, { ts: 't2', eventType: 'message.delivered' }).seq).toBe(2);
    expect(head(db)).toBe(2);
  });

  it('scan returns events in append order and supports sinceSeq', () => {
    append(db, { ts: 't1', eventType: 'message.sent' });
    append(db, { ts: 't2', eventType: 'message.delivered' });
    expect(scan(db).map((e) => e.eventType)).toEqual(['message.sent', 'message.delivered']);
    expect(scan(db, { sinceSeq: 1 }).map((e) => e.seq)).toEqual([2]);
  });

  it('is append-only (no overwrite of prior seq)', () => {
    append(db, { ts: 't1', eventType: 'message.sent' });
    append(db, { ts: 't2', eventType: 'message.sent' });
    expect(scan(db)).toHaveLength(2); // 第二次追加新增行，不覆盖 seq=1
  });

  it('round-trips graph coords and payload', () => {
    append(db, { ts: 't', eventType: 'message.rejected', edgeId: 'X1', payload: { reason: 'payload.incompatible' } });
    const [ev] = scan(db);
    expect(ev.edgeId).toBe('X1');
    expect(ev.payload).toEqual({ reason: 'payload.incompatible' });
  });
});
