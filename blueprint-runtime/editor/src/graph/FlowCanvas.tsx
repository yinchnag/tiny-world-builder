/**
 * ─────────────────────────────────────────────────────────────
 * 组件：editor/src/graph/FlowCanvas（xyflow 画布容器 · L-Graph）
 * 职责：接 graph-store 的 nodes/edges，挂 MiniMap/Controls/Background。
 *       拖拽连线经 planConnection（= core/validate）校验：通过则建 typed 边，
 *       不通过把拒绝码写 ui-store（App 弹横幅）。nodeTypes/edgeTypes 由 app 注入。
 * ─────────────────────────────────────────────────────────────
 */
import { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
} from '@xyflow/react';
import { useGraphStore } from '../state/graph-store';
import { useSelectionStore } from '../state/selection-store';
import { useUiStore } from '../state/ui-store';
import { planConnection } from './connection/plan-connect';

export function FlowCanvas({ nodeTypes, edgeTypes }: { nodeTypes?: NodeTypes; edgeTypes?: EdgeTypes } = {}) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const addEdge = useGraphStore((s) => s.addEdge);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);
  const setConnectReason = useUiStore((s) => s.setConnectReason);
  const seq = useRef(0);

  const onConnect = useCallback(
    (conn: Connection): void => {
      seq.current += 1;
      const plan = planConnection(conn, useGraphStore.getState().nodes, `e-${seq.current}`);
      if (plan.edge !== null) {
        addEdge(plan.edge);
        setConnectReason(null);
      } else {
        setConnectReason(plan.reason);
      }
    },
    [addEdge, setConnectReason],
  );

  return (
    <div style={{ width: '100%', height: '100%' }} data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => clear()}
        fitView
      >
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
