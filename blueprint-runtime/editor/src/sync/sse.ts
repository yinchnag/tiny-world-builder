/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/sse（后端事件流 → store · L-Sync）
 * 职责：订阅后端事件，应用到 graph-store（只读缓存更新，不双写）。
 * ─────────────────────────────────────────────────────────────
 */
import { useGraphStore } from '../state/graph-store';
import type { RuntimeAdapter, Unsubscribe } from './runtime-adapter';
import type { RuntimeEvent } from '@blueprint/core';

/**
 * 把一条后端事件应用到 store（只读缓存更新）：
 *   node.transitioned → 节点状态；message.delivered → 边动画（投递反馈）。
 *
 * @param ev 运行时事件
 * @returns void
 */
export function applyEvent(ev: RuntimeEvent): void {
  if (ev.eventType === 'node.transitioned' && ev.nodeId !== undefined) {
    const to = (ev.payload as { to?: string } | undefined)?.to;
    if (to !== undefined) useGraphStore.getState().applyNodeState(ev.nodeId, to);
    return;
  }
  if (ev.eventType === 'message.delivered' && ev.edgeId !== undefined) {
    useGraphStore.getState().markEdgeDelivered(ev.edgeId);
  }
}

/**
 * 订阅后端事件流并应用到 store。
 *
 * @param adapter 后端适配器
 * @returns 取消订阅
 */
export function connectSse(adapter: RuntimeAdapter): Unsubscribe {
  return adapter.subscribe(applyEvent);
}
