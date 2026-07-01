/**
 * editor/src/app/App（应用外壳 · L-App）：画布 + 契约驱动检视器。
 * 装配点：注册节点 UI、把 nodeTypes/edgeTypes 注入 FlowCanvas（registry 在更高 rank）。
 */
import { useEffect } from 'react';
import { Providers } from './providers';
import { NodePalette } from './NodePalette';
import { FlowCanvas } from '../graph/FlowCanvas';
import { TypedEdge } from '../graph/edges/TypedEdge';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { registerNodeUi, nodeTypes } from '../nodes/registry';
import { GenericNode } from '../nodes/GenericNode';
import { useGraphStore } from '../state/graph-store';
import { useSelectionStore } from '../state/selection-store';
import { useUiStore } from '../state/ui-store';
import { createRuntimeClient } from '../sync/runtime-client';
import { applyEvent } from '../sync/sse';
import { registerBuiltinContracts, BUILTIN_CONTRACTS } from '@blueprint/core';

// 注册全部内置契约 + 把每个类型映射到通用节点组件（新增家族自动接入，无需改本文件）。
registerBuiltinContracts();
for (const c of BUILTIN_CONTRACTS) registerNodeUi(c.type, { node: GenericNode });

const NODE_TYPES = nodeTypes();
const EDGE_TYPES = { typed: TypedEdge };
// runtime 服务地址（EX-5 联跑：先 pnpm serve 起后端）。离线时 SSE 连不上，画布照常工作。
const runtimeClient = createRuntimeClient('http://127.0.0.1:8787');

// 「运行」：把当前图镜像到 runtime，再触发该节点执行（结果经 SSE 回流）。
async function runOnRuntime(nodeId: string): Promise<void> {
  const { nodes, edges } = useGraphStore.getState();
  for (const n of nodes) {
    await runtimeClient.mirror({ kind: 'node', op: 'add', payload: { id: n.id, type: n.type ?? '', properties: n.data.properties } });
  }
  for (const e of edges) {
    if (e.sourceHandle != null && e.targetHandle != null && e.data !== undefined) {
      await runtimeClient.mirror({
        kind: 'edge',
        op: 'add',
        payload: { id: e.id, source: { node: e.source, port: e.sourceHandle }, target: { node: e.target, port: e.targetHandle }, lane: e.data.lane, payloadType: e.data.payloadType },
      });
    }
  }
  await runtimeClient.run(nodeId);
}

export function App() {
  const selectedId = useSelectionStore((s) => [...s.selected][0] ?? null);
  const connectReason = useUiStore((s) => s.connectReason);
  useEffect(() => runtimeClient.subscribe(applyEvent), []);
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
          <InspectorPanel nodeId={selectedId} onRun={(id) => void runOnRuntime(id)} />
        </aside>
      </div>
    </Providers>
  );
}
