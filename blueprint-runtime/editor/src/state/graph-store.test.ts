/**
 * graph-store 单测：单一来源增节点/边 + SSE 只读缓存更新。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from './graph-store';
import type { FlowNode } from '../lib/flow-types';

function node(id: string, state = 'idle'): FlowNode {
  return { id, type: 'agent', position: { x: 0, y: 0 }, data: { state, properties: {} } };
}

beforeEach(() => {
  useGraphStore.setState({ nodes: [], edges: [] });
});

describe('graph-store', () => {
  it('addNode appends to the single source', () => {
    useGraphStore.getState().addNode(node('A'));
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it('applyNodeState updates node data.state (read-only runtime cache)', () => {
    useGraphStore.getState().addNode(node('A', 'idle'));
    useGraphStore.getState().applyNodeState('A', 'working');
    expect(useGraphStore.getState().nodes[0].data.state).toBe('working');
  });
});
