/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/graph/adapters/to-xyflow（core → xyflow 映射）
 * 职责：把 core 域 Node/Edge 映射成 xyflow 形态（端口→Handle 位）。
 * ─────────────────────────────────────────────────────────────
 */
import type { GraphNode, Edge } from '@blueprint/core';
import type { FlowNode, FlowEdge } from '../../lib/flow-types';

/**
 * core 节点 → xyflow 节点。
 *
 * @param n core 节点
 * @returns xyflow 节点
 */
export function nodeToXY(n: GraphNode): FlowNode {
  return {
    id: n.id,
    type: n.type,
    position: { x: n.view?.x ?? 0, y: n.view?.y ?? 0 },
    data: { state: n.state, properties: n.properties as Record<string, unknown> },
  };
}

/**
 * core 边 → xyflow 边（端口 id → sourceHandle/targetHandle）。
 *
 * @param e core 边
 * @returns xyflow 边
 */
export function edgeToXY(e: Edge): FlowEdge {
  return {
    id: e.id,
    source: e.source.node,
    target: e.target.node,
    sourceHandle: e.source.port,
    targetHandle: e.target.port,
    data: { lane: e.lane, payloadType: e.payloadType, semanticKind: e.semanticKind },
  };
}
