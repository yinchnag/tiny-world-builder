/**
 * ─────────────────────────────────────────────────────────────
 * 组件：editor/src/graph/FlowCanvas（xyflow 画布容器 · L-Graph）
 * 职责：接 graph-store 的 nodes/edges，挂 MiniMap/Controls/Background。
 *       平移/缩放/拖连/边路由/小地图由 xyflow 提供，不再手写（20 §2）。
 * ─────────────────────────────────────────────────────────────
 */
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import { useGraphStore } from '../state/graph-store';

export function FlowCanvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  return (
    <div style={{ width: '100%', height: '100%' }} data-testid="flow-canvas">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
