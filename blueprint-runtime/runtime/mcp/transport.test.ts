/**
 * runtime/mcp/transport 单测：dispatch 逻辑 + 对 protocol-samples REQ_CALL 的契约断言。
 */
import { describe, it, expect } from 'vitest';
import { dispatch, type JsonRpcRequest } from './transport';
import { createToolRegistry } from './tools/registry';
import { REQ_CALL } from '../../core/test/fixtures/protocol-samples';

describe('transport dispatch', () => {
  it('accepts protocol-samples REQ_CALL and routes to the handler', () => {
    const reg = createToolRegistry();
    reg.register({ name: 'agent_report', mutates: true, adminOnly: false, handler: (r) => ({ ok: true, value: r.arguments }) });
    const resp = dispatch(reg, [], REQ_CALL as unknown as JsonRpcRequest);
    expect(resp.result).toEqual({ ok: true, value: { summary: 'done' } });
  });

  it('unknown method → JSON-RPC error -32601', () => {
    const resp = dispatch(createToolRegistry(), [], { jsonrpc: '2.0', id: 1, method: 'foo', params: {} });
    expect(resp.error?.code).toBe(-32601);
  });

  it('unknown tool → JSON-RPC error -32602', () => {
    const resp = dispatch(createToolRegistry(), [], { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
    expect(resp.error?.code).toBe(-32602);
  });
});
