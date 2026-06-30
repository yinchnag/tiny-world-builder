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

/** 功能阶段（BP）登记的事件类型（§5.6；与地基闭集合并为已知集）。 */
export const FEATURE_EVENT_TYPES = [
  'cache.hit', // BP Cache：精确记忆化命中（可审计，vision §7）
  'cache.miss', // BP Cache：未命中（计算并存）
] as const;

/** 事件类型名（`<domain>.<verb>`，全小写点分）。 */
export type EventType = string;

const KNOWN: ReadonlySet<string> = new Set([...FOUNDATION_EVENT_TYPES, ...FEATURE_EVENT_TYPES]);

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

/**
 * 运行时事件（事件溯源主存的元素 · 00 §5.5）。
 * 图坐标（nodeId/portId/edgeId）让任何事件都能回指到节点/端口/边。
 * seq 由 event-log 追加时分配（全局自增）。
 */
export interface RuntimeEvent {
  readonly seq: number;
  readonly ts: string;
  readonly eventType: EventType;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly nodeId?: string;
  readonly portId?: string;
  readonly edgeId?: string;
  readonly workflowTemplateId?: string;
  readonly workflowInstanceId?: string;
  readonly payloadType?: string;
  readonly payload?: unknown;
  readonly correlationId?: string;
}
