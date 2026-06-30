/**
 * ─────────────────────────────────────────────────────────────
 * Fx 集成冒烟：真 runtime ⇔ 真 editor，over MCP（HTTP + SSE）。
 *
 * 这是地基的合龙测试：证明前后端在**线上**达成一致，而非各自对夹具达成一致。
 *  - 出向：editor/sync/mcp-client 产出的 JSON-RPC 被 runtime/mcp/transport 接受并回结果
 *  - 入向：runtime/mcp/sse 推出的事件帧，被 editor/sync 的 applyEvent 落进 graph-store
 *
 * 位置说明：本文件在顶层 `integration/`（不属 editor/runtime 元素），故 R3「前后端
 * 不直连」的字符串禁令与 boundaries 都不覆盖它——集成层正是被允许同时握两侧的地方。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createTransport } from '../runtime/mcp/transport';
import { createToolRegistry } from '../runtime/mcp/tools/registry';
import { createSseHub } from '../runtime/mcp/sse';
import { createMcpClient } from '../editor/src/sync/mcp-client';
import { applyEvent } from '../editor/src/sync/sse';
import { useGraphStore } from '../editor/src/state/graph-store';
// 顶层 integration/ 无 @blueprint/core 软链，直接走 core 桶（仅取类型）。
import type { RuntimeEvent } from '../core/index';

describe('Fx integration (real runtime ⇔ real editor over MCP)', () => {
  it('editor mcp-client ⇆ runtime transport; runtime SSE drives editor store', async () => {
    const registry = createToolRegistry();
    registry.register({
      name: 'agent_report',
      mutates: true,
      adminOnly: false,
      handler: (r) => ({ ok: true, value: { echo: r.arguments } }),
    });
    const hub = createSseHub();
    const server = createTransport({ registry, middlewares: [], hub });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // ── 出向：editor mcp-client → runtime transport（真 HTTP JSON-RPC 往返）
      const client = createMcpClient(`http://127.0.0.1:${port}`);
      const result = await client.call('agent_report', { summary: 'done' });
      expect(result).toEqual({ ok: true, value: { echo: { summary: 'done' } } });

      // ── 入向：runtime SSE 帧 → editor applyEvent → graph-store
      useGraphStore.setState({
        nodes: [{ id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } }],
        edges: [],
      });
      const sse = await fetch(`http://127.0.0.1:${port}/mcp/sse`);
      if (sse.body === null) throw new Error('no SSE body');
      const reader = sse.body.getReader();
      hub.push({ seq: 9, ts: 't', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });

      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine === undefined) throw new Error('no data line in SSE frame');
      const ev = JSON.parse(dataLine.slice('data:'.length).trim()) as RuntimeEvent;

      applyEvent(ev);
      expect(useGraphStore.getState().nodes[0].data.state).toBe('working');

      await reader.cancel();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
