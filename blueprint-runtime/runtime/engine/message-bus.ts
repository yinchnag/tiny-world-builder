/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/message-bus（类型化消息总线 · L4）
 * 职责：按 Edge 把载荷从 out 口路由到 in 口；投递前做运行期类型防线。
 *
 * 运行期类型防线（10 §3 / 00 §2.2）：
 *   route() 投递前调 core/validate.canConnect + validatePayload——与前端编辑期
 *   用的是同一函数。校验失败 → 产出 message.rejected，不投递。
 * ─────────────────────────────────────────────────────────────
 */
import type { Edge } from '../../core/graph/edge';
import type { Port } from '../../core/graph/port';
import { canConnect, validatePayload } from '../../core/validate';
import type { ReasonCode } from '../../core/events';
import type { Clock } from '../kernel/clock';
import type { EventInput } from '../persist/event-log';

/** 路由结果：是否投递 + 待追加事件（delivered 或 rejected）。 */
export interface RouteResult {
  readonly delivered: boolean;
  readonly event: EventInput;
}

function reject(edge: Edge, reason: ReasonCode | undefined, clock: Clock): RouteResult {
  return {
    delivered: false,
    event: { ts: clock.nowIso(), eventType: 'message.rejected', edgeId: edge.id, payload: { reason } },
  };
}

/**
 * 沿一条边投递一条载荷（运行期类型防线）。
 *
 * @param edge 目标边
 * @param sourcePort 源 out 端口
 * @param targetPort 目标 in 端口
 * @param payload 实际载荷
 * @param clock 时钟
 * @returns 路由结果（delivered + message.delivered 事件，或 message.rejected）
 */
export function route(edge: Edge, sourcePort: Port, targetPort: Port, payload: unknown, clock: Clock): RouteResult {
  const conn = canConnect(sourcePort, targetPort);
  if (!conn.ok) return reject(edge, conn.reason, clock);
  const pay = validatePayload(edge.payloadType, payload);
  if (!pay.ok) return reject(edge, pay.reason, clock);
  return {
    delivered: true,
    event: { ts: clock.nowIso(), eventType: 'message.delivered', edgeId: edge.id, payloadType: edge.payloadType },
  };
}
