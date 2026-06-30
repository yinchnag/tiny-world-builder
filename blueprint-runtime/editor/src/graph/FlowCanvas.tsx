/**
 * ─────────────────────────────────────────────────────────────
 * 组件：editor/src/graph/FlowCanvas（xyflow 画布容器 · L-Graph）
 * 职责：接 graph-store 的 nodes/edges，挂 MiniMap/Controls/Background。
 *       nodeTypes/edgeTypes 由上层（app）注入（registry 在更高 rank，graph 不直接 import）。
 * ─────────────────────────────────────────────────────────────
 */
import { ReactFlow, Background, Controls, MiniMap, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import { useGraphStore } from '../state/graph-store';

export function FlowCanvas({ nodeTypes, edgeTypes }: { nodeTypes?: NodeTypes; edgeTypes?: EdgeTypes } = {}) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  return (
    <div style={{ width: '100%', height: '100%' }} data-testid="flow-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView>
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
