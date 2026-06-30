/**
 * mcp-client 单测：产出 tools/call 请求（REQ_CALL 形状）+ 解析 result。
 */
import { describe, it, expect } from 'vitest';
import { createMcpClient } from './mcp-client';

describe('mcp-client', () => {
  it('builds a tools/call request and returns the result', async () => {
    let captured: { method?: string; params?: { name: string; arguments: unknown } } = {};
    const fetchFn = (async (_url: string, init?: RequestInit): Promise<Response> => {
      captured = JSON.parse(String(init?.body));
      return { json: async () => ({ result: { ok: true, value: { seq: 3 } } }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createMcpClient('http://x', fetchFn);
    const r = await client.call('agent_report', { summary: 'done' });

    expect(r).toEqual({ ok: true, value: { seq: 3 } });
    expect(captured.method).toBe('tools/call');
    expect(captured.params).toEqual({ name: 'agent_report', arguments: { summary: 'done' } });
  });
});
