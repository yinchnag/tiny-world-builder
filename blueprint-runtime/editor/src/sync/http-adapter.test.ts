/**
 * http-adapter 单测：mirror 发 create_node/create_edge 工具调用（SSE 流由集成测试覆盖）。
 */
import { describe, it, expect } from 'vitest';
import { createHttpAdapter } from './http-adapter';

describe('http-adapter', () => {
  it('mirror posts create_node / create_edge tools/call', async () => {
    const calls: { name: string; arguments: unknown }[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: unknown } };
      calls.push(body.params);
      return { json: async () => ({ result: { ok: true } }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = createHttpAdapter('http://x', fetchFn);
    await adapter.mirror({ kind: 'node', op: 'add', payload: { id: 'A', type: 'agent' } });
    await adapter.mirror({ kind: 'edge', op: 'add', payload: { id: 'E1' } });

    expect(calls.map((c) => c.name)).toEqual(['create_node', 'create_edge']);
    expect(calls[0].arguments).toEqual({ id: 'A', type: 'agent' });
  });
});
