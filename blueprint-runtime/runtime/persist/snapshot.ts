/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/persist/snapshot（快照 · L3）
 * 职责：周期性快照，避免每次从 seq=0 重放；重建 = 快照 + 快照后增量重放。
 * ─────────────────────────────────────────────────────────────
 */
import type { Db } from './sqlite-adapter';
import { scan } from './event-log';
import type { Projection } from './projections/index';

/** 某投影在某 seq 时的状态快照。 */
export interface Snapshot<S> {
  readonly seq: number;
  readonly state: S;
}

/**
 * 取快照（记录到此刻 seq 的投影状态）。
 *
 * @param seq 快照对应的最新 seq
 * @param state 该 seq 时的投影状态
 * @returns 快照
 */
export function take<S>(seq: number, state: S): Snapshot<S> {
  return { seq, state };
}

/**
 * 从快照 + 增量重放重建状态（只重放 snap.seq 之后的事件）。
 *
 * @param db 数据库句柄
 * @param projection 投影
 * @param snap 快照
 * @returns 重建后的状态
 */
export function restoreAndReplay<S>(db: Db, projection: Projection<S>, snap: Snapshot<S>): S {
  return scan(db, { sinceSeq: snap.seq }).reduce((s, ev) => projection.apply(ev, s), snap.state);
}
