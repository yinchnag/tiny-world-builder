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
import { useSelectionStore } from '../state/selection-store';
import { useUiStore } from '../state/ui-store';
import { registerBuiltinContracts, BUILTIN_CONTRACTS } from '@blueprint/core';

// 注册全部内置契约 + 把每个类型映射到通用节点组件（新增家族自动接入，无需改本文件）。
registerBuiltinContracts();
for (const c of BUILTIN_CONTRACTS) registerNodeUi(c.type, { node: GenericNode });

const NODE_TYPES = nodeTypes();
const EDGE_TYPES = { typed: TypedEdge };

export function App() {
  const selectedId = useSelectionStore((s) => [...s.selected][0] ?? null);
  const connectReason = useUiStore((s) => s.connectReason);
  return (
    <Providers>
      <div style={{ position: 'relative', display: 'flex', width: '100vw', height: '100vh' }}>
        {connectReason !== null && (
          <div
            data-testid="connect-reason"
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              background: '#fde2e2',
              color: '#a11',
              border: '1px solid #f3a0a0',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
            }}
          >
            连接被拒：{connectReason}
          </div>
        )}
        <NodePalette />
        <div style={{ flex: 1 }}>
          <FlowCanvas nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} />
        </div>
        <aside style={{ width: 280, borderLeft: '1px solid #ddd', padding: 8, overflow: 'auto' }}>
          <InspectorPanel nodeId={selectedId} />
        </aside>
      </div>
    </Providers>
  );
}
