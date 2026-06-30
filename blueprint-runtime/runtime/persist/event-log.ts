/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/persist/event-log（事件溯源主存 · L3）
 * 职责：追加 + 顺序读取不可变事件（自增 seq）。审计即主存：当前状态由事件投影得出。
 *
 * 设计要点：
 *   - 只追加（append），不修改/不删除——过期数据靠投影忽略，不删事件（10 §7）。
 *   - 列名 snake_case（DB 物理），与 RuntimeEvent 的 camelCase 在此互转（00 §5.5）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Db } from './sqlite-adapter';
import type { RuntimeEvent } from '../../core/events';

/** 追加用事件（seq 由本模块分配）。 */
export type EventInput = Omit<RuntimeEvent, 'seq'>;

/** event_log 行（snake_case 列）。 */
interface Row {
  seq: number;
  ts: string;
  event_type: string;
  actor_type: string | null;
  actor_id: string | null;
  node_id: string | null;
  port_id: string | null;
  edge_id: string | null;
  payload_type: string | null;
  payload_json: string | null;
  correlation_id: string | null;
}

const INSERT_SQL = `
  INSERT INTO event_log
    (ts, actor_type, actor_id, event_type, node_id, port_id, edge_id, payload_type, payload_json, correlation_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function rowToEvent(r: Row): RuntimeEvent {
  return {
    seq: r.seq,
    ts: r.ts,
    eventType: r.event_type,
    actorType: r.actor_type ?? undefined,
    actorId: r.actor_id ?? undefined,
    nodeId: r.node_id ?? undefined,
    portId: r.port_id ?? undefined,
    edgeId: r.edge_id ?? undefined,
    payloadType: r.payload_type ?? undefined,
    payload: r.payload_json !== null ? JSON.parse(r.payload_json) : undefined,
    correlationId: r.correlation_id ?? undefined,
  };
}

/**
 * 追加一条事件（只追加），返回带分配 seq 的完整事件。
 *
 * @param db 数据库句柄
 * @param ev 待追加事件（不含 seq）
 * @returns 带 seq 的 RuntimeEvent
 */
export function append(db: Db, ev: EventInput): RuntimeEvent {
  const info = db
    .prepare(INSERT_SQL)
    .run(
      ev.ts,
      ev.actorType ?? null,
      ev.actorId ?? null,
      ev.eventType,
      ev.nodeId ?? null,
      ev.portId ?? null,
      ev.edgeId ?? null,
      ev.payloadType ?? null,
      ev.payload !== undefined ? JSON.stringify(ev.payload) : null,
      ev.correlationId ?? null,
    );
  return { ...ev, seq: Number(info.lastInsertRowid) };
}

/**
 * 顺序读取事件（seq 升序；可从某 seq 之后、限量）。
 *
 * @param db 数据库句柄
 * @param opts 读取选项
 * @param opts.sinceSeq 只取该 seq 之后（默认 0，即全部）
 * @param opts.limit 限量（默认 -1 不限）
 * @returns 事件数组
 */
export function scan(db: Db, opts: { sinceSeq?: number; limit?: number } = {}): RuntimeEvent[] {
  const rows = db
    .prepare('SELECT * FROM event_log WHERE seq > ? ORDER BY seq ASC LIMIT ?')
    .all(opts.sinceSeq ?? 0, opts.limit ?? -1) as unknown as Row[];
  return rows.map(rowToEvent);
}

/**
 * 当前最新 seq（无事件返回 0）。
 *
 * @param db 数据库句柄
 * @returns 最新 seq
 */
export function head(db: Db): number {
  const row = db.prepare('SELECT MAX(seq) AS m FROM event_log').get() as unknown as { m: number | null };
  return row.m ?? 0;
}
