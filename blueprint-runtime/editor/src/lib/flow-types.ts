/**
 * editor 的 xyflow 形态类型（00 §5.3 view/runtime 分离）。
 * node.type=契约类型；position=视图；data=运行真相（只读缓存）。
 */
import type { Node as XYNode, Edge as XYEdge } from '@xyflow/react';
import type { Lane } from '@blueprint/core';

/** xyflow 节点 data：运行状态（由后端 SSE 同步，只读缓存）+ 实例属性。 */
export interface FlowNodeData extends Record<string, unknown> {
  state: string;
  properties: Record<string, unknown>;
}

/** editor 节点（xyflow 形态）。 */
export type FlowNode = XYNode<FlowNodeData>;

/** xyflow 边 data：携带 core Edge 的 lane/payloadType。 */
export interface FlowEdgeData extends Record<string, unknown> {
  lane: Lane;
  payloadType: string;
  semanticKind?: string;
}

/** editor 边（xyflow 形态）。 */
export type FlowEdge = XYEdge<FlowEdgeData>;
