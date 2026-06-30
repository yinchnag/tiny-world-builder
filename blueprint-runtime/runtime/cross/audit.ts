/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/cross/audit（时间线/审计视图 · 横切）
 * 职责：审计就是 event-log——本模块只做**只读**查询与归类，绝不写。
 *       写入只发生在 L3 event-log.append（10 §3 关键差异）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Db } from '../persist/sqlite-adapter';
import { scan } from '../persist/event-log';
import type { RuntimeEvent } from '../../core/events';

/**
 * 读取时间线（只读 event-log）。
 *
 * @param db 数据库句柄
 * @param opts 读取选项
 * @param opts.sinceSeq 只取该 seq 之后（默认 0）
 * @param opts.limit 限量（默认 -1 不限）
 * @returns 事件数组
 */
export function timeline(db: Db, opts: { sinceSeq?: number; limit?: number } = {}): RuntimeEvent[] {
  return scan(db, opts);
}
