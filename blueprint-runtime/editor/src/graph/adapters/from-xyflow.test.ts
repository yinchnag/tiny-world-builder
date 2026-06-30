/**
 * from-xyflow 单测：xyflow 连接 → core 端口级边。
 */
import { describe, it, expect } from 'vitest';
import { connectionToEdge } from './from-xyflow';

describe('from-xyflow', () => {
  it('builds a core edge from a complete connection', () => {
    const e = connectionToEdge('E1', { source: 'A', target: 'B', sourceHandle: 'report_out', targetHandle: 'message_in' }, 'message', 'AgentReport');
    expect(e).toMatchObject({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message' });
  });

  it('returns null when handles are missing', () => {
    expect(connectionToEdge('E', { source: 'A', target: 'B', sourceHandle: null, targetHandle: null }, 'message', 'AgentReport')).toBeNull();
  });
});
