/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/events（事件类型词表 + 共享码表 · 00 §5.6/§5.7）
 * 职责：跨 MCP/SSE 线的「事件名」与「拒绝/契约码」常量唯一来源，前后端共用。
 *
 * 在分层中的位置（core 最底层叶子，谁都不依赖）：
 *   validate / runtime / editor ──► 本模块（取事件名与码，禁各自造名）
 *
 * 设计要点：
 *   - 地基闭集 = 引擎自身产出的事件（node-machine + message-bus）。
 *   - 功能事件（agent.* / task.* 等）由 BP 阶段登记，须遵守 §5.6 命名/必填规则。
 * ─────────────────────────────────────────────────────────────
 */

/** 地基阶段引擎自身产出的事件类型闭集（§5.6）。 */
export const FOUNDATION_EVENT_TYPES = [
  'node.transitioned',
  'message.sent',
  'message.delivered',
  'message.rejected',
] as const;

/** 事件类型名（`<domain>.<verb>`，全小写点分）。 */
export type EventType = string;

const KNOWN: ReadonlySet<string> = new Set(FOUNDATION_EVENT_TYPES);

/**
 * 是否地基闭集内的已知事件类型（兜底校验未登记的事件名）。
 *
 * @param t 事件类型名
 * @returns 是否已知
 */
export function isKnownEventType(t: string): boolean {
  return KNOWN.has(t);
}

/** §5.7 共享拒绝/契约码（编辑期与运行期同用）。 */
export const REASON_CODES = [
  'lane.mismatch',
  'payload.incompatible',
  'port.not_found',
  'direction.invalid',
  'cardinality.exceeded',
  'required.unmet',
  'payload.schema_invalid',
  'contract.invalid',
] as const;

/** §5.7 码类型。 */
export type ReasonCode = (typeof REASON_CODES)[number];
