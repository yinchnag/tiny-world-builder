/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/persist/projections（投影框架 · L3）
 * 职责：定义 Projection 契约 + 从事件全量重放得到当前状态。
 *
 * 投影是纯函数 (event, prevState) => nextState：同序列重放必得同状态，
 * 否则快照/重建会发散（GUIDE §4 范例）。
 * ─────────────────────────────────────────────────────────────
 */
import type { RuntimeEvent } from '../../../core/events';
import type { Db } from '../sqlite-adapter';
import { scan } from '../event-log';

/** 投影：纯函数把事件流折叠成某个读视图状态。 */
export interface Projection<S> {
  readonly name: string;
  init(): S;
  apply(ev: RuntimeEvent, prev: S): S;
}

/**
 * 从 seq=0 全量重放，得到投影当前状态。
 *
 * @param db 数据库句柄
 * @param projection 投影
 * @returns 投影当前状态
 */
export function rebuild<S>(db: Db, projection: Projection<S>): S {
  return scan(db).reduce((s, ev) => projection.apply(ev, s), projection.init());
}
