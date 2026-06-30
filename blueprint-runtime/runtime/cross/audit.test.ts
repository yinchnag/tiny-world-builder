/**
 * runtime/cross/audit 单测：时间线只读 event-log（不写）。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../persist/sqlite-adapter';
import { append, scan } from '../persist/event-log';
import { timeline } from './audit';

describe('audit timeline', () => {
  it('reads events as a read-only view and never writes', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't1', eventType: 'message.sent' });
    expect(timeline(db).map((e) => e.eventType)).toEqual(['message.sent']);
    timeline(db); // 反复读不应改变事件数
    expect(scan(db)).toHaveLength(1);
  });
});
