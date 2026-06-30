/**
 * core/graph/edge 单测：构造默认值。
 */
import { describe, it, expect } from 'vitest';
import { createEdge } from './edge';

describe('createEdge', () => {
  it('defaults directed to true and carries lane/payloadType', () => {
    const e = createEdge({
      id: 'E1',
      source: { node: 'A', port: 'report_out' },
      target: { node: 'B', port: 'message_in' },
      lane: 'message',
      payloadType: 'AgentReport',
    });
    expect(e.directed).toBe(true);
    expect(e.lane).toBe('message');
    expect(e.source.port).toBe('report_out');
  });
});
