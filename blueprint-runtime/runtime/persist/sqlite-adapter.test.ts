/**
 * runtime/persist/sqlite-adapter 单测（探针）：node:sqlite 可用 + 建表往返。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from './sqlite-adapter';

describe('sqlite-adapter', () => {
  it('opens an in-memory db, migrates, and round-trips a row', () => {
    const db = openDb();
    migrate(db);
    db.prepare('INSERT INTO event_log (ts, event_type) VALUES (?, ?)').run('2026-06-30T00:00:00Z', 'message.sent');
    const row = db.prepare('SELECT seq, event_type FROM event_log').get() as { seq: number; event_type: string };
    expect(row.event_type).toBe('message.sent');
    expect(row.seq).toBe(1);
    db.close();
  });
});
