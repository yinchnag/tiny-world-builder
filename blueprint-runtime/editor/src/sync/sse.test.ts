/**
 * sse 单测：mock adapter 同步流——后端事件 → store 节点状态。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../state/graph-store';
import { createMockAdapter } from './runtime-adapter';
import { connectSse } from './sse';

beforeEach(() => {
  useGraphStore.setState({
    nodes: [{ id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } }],
    edges: [],
  });
});

describe('sse sync flow', () => {
  it('applies a backend node.transitioned event to the store', () => {
    const adapter = createMockAdapter();
    const unsub = connectSse(adapter);
    adapter.emit({ seq: 1, ts: 't', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } });
    expect(useGraphStore.getState().nodes[0].data.state).toBe('working');
    unsub();
  });

  it('animates an edge on message.delivered (投递反馈)', () => {
    useGraphStore.setState({
      nodes: [],
      edges: [{ id: 'E1', source: 'A', target: 'B', data: { lane: 'message', payloadType: 'AgentMessage' } }],
    });
    const adapter = createMockAdapter();
    const unsub = connectSse(adapter);
    adapter.emit({ seq: 2, ts: 't', eventType: 'message.delivered', edgeId: 'E1', payloadType: 'AgentMessage' });
    expect(useGraphStore.getState().edges[0].animated).toBe(true);
    unsub();
  });
});
