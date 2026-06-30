/**
 * to-xyflow 单测：core → xyflow 映射（端口→Handle、view→position）。
 */
import { describe, it, expect } from 'vitest';
import { nodeToXY, edgeToXY } from './to-xyflow';
import { createNode, createEdge } from '@blueprint/core';

describe('to-xyflow', () => {
  it('maps a core node to xyflow (type/position/data)', () => {
    const xy = nodeToXY(createNode({ id: 'A', type: 'agent', state: 'idle', properties: { model: 'opus' } }));
    expect(xy).toMatchObject({ id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: { model: 'opus' } } });
  });

  it('maps a core edge to xyflow with port handles + lane/payloadType', () => {
    const e = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
    const xy = edgeToXY(e);
    expect(xy).toMatchObject({ id: 'E1', source: 'A', target: 'B', sourceHandle: 'report_out', targetHandle: 'message_in', data: { lane: 'message', payloadType: 'AgentReport' } });
  });
});
