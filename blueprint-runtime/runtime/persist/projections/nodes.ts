/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/persist/projections/nodes（节点状态投影 · L3）
 * 职责：由 node.transitioned 事件投影「节点当前状态」（nodeId → state）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Projection } from './index';

/** 节点状态读视图：nodeId → 当前状态值。 */
export type NodeStates = Record<string, string>;

/** 由 node.transitioned 事件投影节点状态；其余事件忽略（纯函数）。 */
export const nodesProjection: Projection<NodeStates> = {
  name: 'nodes',
  init: () => ({}),
  apply: (ev, prev) => {
    if (ev.eventType === 'node.transitioned' && ev.nodeId !== undefined) {
      const to = (ev.payload as { to?: string } | undefined)?.to;
      if (to !== undefined) return { ...prev, [ev.nodeId]: to };
    }
    return prev;
  },
};
