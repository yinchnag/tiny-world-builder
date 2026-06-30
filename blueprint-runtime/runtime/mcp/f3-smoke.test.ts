/**
 * F3 冒烟：本地 server JSON-RPC 往返 + SSE 推送（端到端走 HTTP）。
 */
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createTransport } from './transport';
import { createToolRegistry } from './tools/registry';
import { createSseHub } from './sse';

describe('F3 smoke', () => {
  it('JSON-RPC roundtrip + SSE over a local HTTP server', async () => {
    const registry = createToolRegistry();
    registry.register({ name: 'echo', mutates: false, adminOnly: false, handler: (r) => ({ ok: true, value: r.arguments }) });
    const hub = createSseHub();
    const server = createTransport({ registry, middlewares: [], hub });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // JSON-RPC 往返
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { hi: 1 } } }),
      });
      const json = (await resp.json()) as { result?: unknown };
      expect(json.result).toEqual({ ok: true, value: { hi: 1 } });

      // SSE：连上后推一条事件，断言收到帧
      const sse = await fetch(`http://127.0.0.1:${port}/mcp/sse`);
      if (sse.body === null) throw new Error('no SSE body');
      const reader = sse.body.getReader();
      hub.push({ seq: 7, ts: 't', eventType: 'message.delivered', edgeId: 'E1' });
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('event: message.delivered');
      await reader.cancel();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
