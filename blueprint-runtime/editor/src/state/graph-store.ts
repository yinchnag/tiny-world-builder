/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/state/graph-store（图文档单一来源 · L-State）
 * 职责：持 xyflow 形态的 nodes/edges（core 域数据内嵌 data）；用 zundo 提供撤销历史。
 *
 * view/runtime 分离（00 §5.3 / 20 §6）：position=视图；data.state=运行真相，
 * 由 SSE 经 applyNodeState 只读缓存更新，不双写。
 * ─────────────────────────────────────────────────────────────
 */
import { create } from 'zustand';
import { temporal } from 'zundo';
import type { FlowNode, FlowEdge } from '../lib/flow-types';

/** 图文档状态 + 动作。 */
export interface GraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  addNode(node: FlowNode): void;
  addEdge(edge: FlowEdge): void;
  setGraph(nodes: FlowNode[], edges: FlowEdge[]): void;
  applyNodeState(nodeId: string, state: string): void;
}

/** 图文档 store（zundo temporal 包裹，撤销历史经 useGraphStore.temporal）。 */
export const useGraphStore = create<GraphState>()(
  temporal((set) => ({
    nodes: [],
    edges: [],
    addNode: (node: FlowNode): void => set((s) => ({ nodes: [...s.nodes, node] })),
    addEdge: (edge: FlowEdge): void => set((s) => ({ edges: [...s.edges, edge] })),
    setGraph: (nodes: FlowNode[], edges: FlowEdge[]): void => set({ nodes, edges }),
    applyNodeState: (nodeId: string, state: string): void =>
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, state } } : n)),
      })),
  })),
);
