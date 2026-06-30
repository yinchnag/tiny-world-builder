/**
 * 模块：runtime/engine/exec/inbox（输入物化 · L4 · EX-0）
 * 职责：把投递到某节点各 in 口的载荷折叠出来（D1：message.delivered 带 nodeId/portId/payload）。
 *       事件溯源原生——扫 message.delivered，按 portId 归集。
 */
import { scan } from '../../persist/event-log';
import type { Db } from '../../persist/sqlite-adapter';

/**
 * 物化一个节点各 in 口已收到的载荷。
 *
 * @param db 事件主存
 * @param nodeId 目标节点
 * @returns portId → 载荷列表（无则缺省该键）
 */
export function materializeInbox(db: Db, nodeId: string): Record<string, unknown[]> {
  const inbox: Record<string, unknown[]> = {};
  for (const ev of scan(db)) {
    if (ev.eventType !== 'message.delivered' || ev.nodeId !== nodeId || ev.portId === undefined) continue;
    (inbox[ev.portId] ??= []).push(ev.payload);
  }
  return inbox;
}
