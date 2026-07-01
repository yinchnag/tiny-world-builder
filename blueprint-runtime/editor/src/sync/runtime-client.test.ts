/**
 * runtime-client 单测：run() 发 run_node 工具调用；mirror 发 create_*。
 */
import { describe, it, expect } from 'vitest';
import { createRuntimeClient } from './runtime-client';

describe('runtime-client', () => {
  it('run posts run_node; mirror posts create_node', async () => {
    const calls: { name: string; arguments: unknown }[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: unknown } };
      calls.push(body.params);
      return { json: async () => ({ result: { ok: true } }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createRuntimeClient('http://x', fetchFn);
    await client.mirror({ kind: 'node', op: 'add', payload: { id: 'A', type: 'agent' } });
    await client.run('A');

    expect(calls.map((c) => c.name)).toEqual(['create_node', 'run_node']);
    expect(calls[1].arguments).toEqual({ nodeId: 'A' });
  });
});
