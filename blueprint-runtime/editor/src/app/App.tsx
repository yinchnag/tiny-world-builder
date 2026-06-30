/**
 * editor/src/app/App（应用外壳 · L-App）：画布 + 契约驱动检视器。
 * 装配点：注册节点 UI、把 nodeTypes/edgeTypes 注入 FlowCanvas（registry 在更高 rank）。
 */
import { Providers } from './providers';
import { NodePalette } from './NodePalette';
import { FlowCanvas } from '../graph/FlowCanvas';
import { TypedEdge } from '../graph/edges/TypedEdge';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { registerNodeUi, nodeTypes } from '../nodes/registry';
import { GenericNode } from '../nodes/GenericNode';
import { useGraphStore } from '../state/graph-store';
import { useSelectionStore } from '../state/selection-store';
import { registerBuiltinContracts } from '@blueprint/core';

// 让 core/contracts 知道全部内置契约（检视器/校验据此渲染与判定）。
registerBuiltinContracts();
registerNodeUi('agent', { node: GenericNode });
registerNodeUi('human_gate', { node: GenericNode });

const NODE_TYPES = nodeTypes();
const EDGE_TYPES = { typed: TypedEdge };

export function App() {
  const selectedId = useSelectionStore((s) => [...s.selected][0] ?? null);
  const selectedType = useGraphStore((s) => s.nodes.find((n) => n.id === selectedId)?.type ?? null);
  return (
    <Providers>
      <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
        <NodePalette />
        <div style={{ flex: 1 }}>
          <FlowCanvas nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} />
        </div>
        <aside style={{ width: 280, borderLeft: '1px solid #ddd', padding: 8, overflow: 'auto' }}>
          <InspectorPanel nodeType={selectedType} />
        </aside>
      </div>
    </Providers>
  );
}
