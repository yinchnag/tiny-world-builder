/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/graph/adapters/from-xyflow（xyflow → core 映射）
 * 职责：把 xyflow 的连接/位置变更映射回 core 域更新。
 * ─────────────────────────────────────────────────────────────
 */
import type { Connection } from '@xyflow/react';
import { createEdge, type Edge, type Lane } from '@blueprint/core';

/**
 * xyflow 连接 → core 端口级边（lane/payloadType 由源端口契约给出）。
 *
 * @param id 新边 id
 * @param conn xyflow 连接
 * @param lane 泳道
 * @param payloadType 载荷类型
 * @returns core 边；端点不全则 null
 */
export function connectionToEdge(id: string, conn: Connection, lane: Lane, payloadType: string): Edge | null {
  if (conn.source === null || conn.target === null || conn.sourceHandle == null || conn.targetHandle == null) {
    return null;
  }
  return createEdge({
    id,
    source: { node: conn.source, port: conn.sourceHandle },
    target: { node: conn.target, port: conn.targetHandle },
    lane,
    payloadType,
  });
}
