/**
 * ─────────────────────────────────────────────────────────────
 * BP-2 收尾集成：editor 适配器 ⇄ 真 runtime —— 连线镜像 → 运行期投递 → SSE 反馈。
 *
 * 全链路（over HTTP+SSE）：
 *   editor http-adapter.mirror → runtime create_node/create_edge
 *   runtime deliver → message-bus.route（运行期类型防线）→ message.delivered → SSE
 *   editor applyEvent → graph-store.markEdgeDelivered → 边 animated（投递反馈）
 *
 * 位置在顶层 integration/（非 editor/runtime 元素），故可同握两侧（同 Fx）。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDb, migrate } from '../runtime/persist/sqlite-adapter';
import { createSseHub } from '../runtime/mcp/sse';
import { createToolRegistry } from '../runtime/mcp/tools/registry';
import { registerGraphTools } from '../runtime/mcp/tools/graph-tools';
import { createExecutorRegistry } from '../runtime/engine/exec/executor';
import { createTransport } from '../runtime/mcp/transport';
import { fixedClock } from '../runtime/kernel/clock';
import { createHttpAdapter } from '../editor/src/sync/http-adapter';
import { applyEvent } from '../editor/src/sync/sse';
import { useGraphStore } from '../editor/src/state/graph-store';
import { registerBuiltinContracts } from '../core/index';

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(() => registerBuiltinContracts());

describe('BP-2 deliver (editor adapter ⇄ real runtime over MCP)', () => {
  it('mirrors a graph, delivers a payload, and SSE animates the editor edge', async () => {
    const db = openDb();
    migrate(db);
    const hub = createSseHub();
    const registry = createToolRegistry();
    registerGraphTools(registry, { db, hub, clock: fixedClock('2026-06-30T00:00:00.000Z'), executors: createExecutorRegistry() });
    const server = createTransport({ registry, middlewares: [], hub });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      // editor：画布已有一条边 E1（对应用户拖出的连线），尚未投递
      useGraphStore.setState({
        nodes: [],
        edges: [
          {
            id: 'E1',
            source: 'D',
            target: 'A',
            sourceHandle: 'selection_out',
            targetHandle: 'context_in',
            type: 'typed',
            data: { lane: 'context', payloadType: 'DocumentSelection' },
          },
        ],
      });

      const adapter = createHttpAdapter(base);
      const unsub = adapter.subscribe(applyEvent); // SSE → editor store
      await new Promise((r) => setTimeout(r, 80)); // 等 SSE 连接建立

      // 镜像节点 + 边到后端
      await adapter.mirror({ kind: 'node', op: 'add', payload: { id: 'D', type: 'document' } });
      await adapter.mirror({ kind: 'node', op: 'add', payload: { id: 'A', type: 'agent' } });
      await adapter.mirror({
        kind: 'edge',
        op: 'add',
        payload: { id: 'E1', source: { node: 'D', port: 'selection_out' }, target: { node: 'A', port: 'context_in' }, lane: 'context', payloadType: 'DocumentSelection' },
      });

      // 触发投递（沿 E1 送一条 DocumentSelection 载荷）
      await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'deliver', arguments: { edgeId: 'E1', payload: { text: 'hello' } } } }),
      });

      // 等 message.delivered 经 SSE 回流 → applyEvent → 边 animated
      await waitFor(() => useGraphStore.getState().edges[0]?.animated === true, 3000);
      expect(useGraphStore.getState().edges[0].animated).toBe(true);

      unsub();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
