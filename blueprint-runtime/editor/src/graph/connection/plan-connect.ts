/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/graph/connection/plan-connect（连线规划 · L-Graph）
 * 职责：给一条 xyflow 连接，先 checkConnection（= core/validate）；
 *       通过 → 产出 typed FlowEdge（lane/payloadType 取源端口）；
 *       不通过 → 带 §5.7 拒绝码。纯函数，便于单测与复用。
 * ─────────────────────────────────────────────────────────────
 */
import type { Connection } from '@xyflow/react';
import type { ReasonCode } from '@blueprint/core';
import { checkConnection } from './validate-connection';
import { makeResolver } from './resolve-port';
import type { FlowNode, FlowEdge } from '../../lib/flow-types';

/** 连线规划结果：成功带 typed 边，失败带原因码。 */
export interface ConnectPlan {
  readonly edge: FlowEdge | null;
  readonly reason: ReasonCode | null;
}

/**
 * 规划一条连线。
 *
 * @param conn xyflow 连接
 * @param nodes 当前图节点（解析端口契约）
 * @param edgeId 新边 id
 * @returns 成功 {edge, reason:null}；失败 {edge:null, reason}
 */
export function planConnection(conn: Connection, nodes: readonly FlowNode[], edgeId: string): ConnectPlan {
  const resolve = makeResolver(nodes);
  const check = checkConnection(conn, resolve);
  if (!check.ok) return { edge: null, reason: check.reason ?? null };

  const src = conn.source !== null && conn.sourceHandle != null ? resolve(conn.source, conn.sourceHandle) : undefined;
  if (src === undefined || conn.source === null || conn.target === null || conn.sourceHandle == null || conn.targetHandle == null) {
    return { edge: null, reason: 'port.not_found' };
  }
  const edge: FlowEdge = {
    id: edgeId,
    source: conn.source,
    sourceHandle: conn.sourceHandle,
    target: conn.target,
    targetHandle: conn.targetHandle,
    type: 'typed',
    data: { lane: src.lane, payloadType: src.payloadType },
  };
  return { edge, reason: null };
}
