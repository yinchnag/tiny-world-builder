/**
 * F6 冒烟：editor 自身端到端（对 mock）——建节点 → 连线校验 → 镜像 + SSE。
 */
import { describe, it, expect } from 'vitest';
import { useGraphStore } from '../state/graph-store';
import { checkConnection, type PortResolver } from '../graph/connection/validate-connection';
import { createMockAdapter } from '../sync/runtime-adapter';
import { connectSse } from '../sync/sse';
import { mirrorEdge } from '../sync/mirror';
import { createEdge, createPort } from '@blueprint/core';
import type { FlowNode } from '../lib/flow-types';

const PORTS: Record<string, ReturnType<typeof createPort>> = {
  'A:report_out': createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' }),
  'B:message_in': createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' }),
};
const resolve: PortResolver = (n, p) => PORTS[`${n}:${p}`];

describe('F6 smoke (editor self, against mock)', () => {
  it('build node → validate connection → mirror + SSE applies back', async () => {
    const adapter = createMockAdapter();
    const unsub = connectSse(adapter);
    useGraphStore.setState({ nodes: [], edges: [] });

    // 建节点 A
    const a: FlowNode = { id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } };
    useGraphStore.getState().addNode(a);

    // 连线校验（编辑期类型防线）
    expect(checkConnection({ source: 'A', sourceHandle: 'report_out', target: 'B', targetHandle: 'message_in' }, resolve).ok).toBe(true);

    // 镜像到（mock）后端
    const edge = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
    await mirrorEdge(adapter, edge);
    expect(adapter.mirrored).toHaveLength(1);

    // 后端经 SSE 回推状态推进 → store 只读缓存更新
    adapter.emit({ seq: 1, ts: 't', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });
    expect(useGraphStore.getState().nodes[0].data.state).toBe('working');

    unsub();
  });
});
