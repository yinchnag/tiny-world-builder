/**
 * server 单测：组装的 runtime 服务经 HTTP 接受 create_node（含 CORS）。
 */
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createRuntimeServer } from './server';

describe('createRuntimeServer', () => {
  it('assembles a server that accepts tools/call over HTTP with CORS', async () => {
    const { server } = createRuntimeServer({});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_node', arguments: { id: 'A', type: 'agent' } } }),
      });
      expect(resp.headers.get('access-control-allow-origin')).toBe('*');
      const json = (await resp.json()) as { result?: { ok: boolean } };
      expect(json.result?.ok).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
