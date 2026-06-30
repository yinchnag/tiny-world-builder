/**
 * core/graph/graph 单测：不可变增删查 + removeNode 连带清边。
 */
import { describe, it, expect } from 'vitest';
import { emptyGraph, addNode, addEdge, removeNode, removeEdge, getNode, edgesFrom, edgesTo, listEdges } from './graph';
import { createNode } from './node';
import { createEdge } from './edge';

function sample() {
  let g = emptyGraph();
  g = addNode(g, createNode({ id: 'A', type: 'agent', state: 'idle' }));
  g = addNode(g, createNode({ id: 'B', type: 'agent', state: 'idle' }));
  g = addEdge(
    g,
    createEdge({
      id: 'E1',
      source: { node: 'A', port: 'report_out' },
      target: { node: 'B', port: 'message_in' },
      lane: 'message',
      payloadType: 'AgentReport',
    }),
  );
  return g;
}

describe('graph container', () => {
  it('adds nodes and edges immutably', () => {
    const g = sample();
    expect(getNode(g, 'A')?.id).toBe('A');
    expect(listEdges(g)).toHaveLength(1);
  });

  it('removeNode also removes incident edges', () => {
    const g = removeNode(sample(), 'B');
    expect(getNode(g, 'B')).toBeUndefined();
    expect(listEdges(g)).toHaveLength(0); // E1 touched B
  });

  it('edgesFrom / edgesTo query direction', () => {
    const g = sample();
    expect(edgesFrom(g, 'A').map((e) => e.id)).toEqual(['E1']);
    expect(edgesTo(g, 'B').map((e) => e.id)).toEqual(['E1']);
    expect(edgesFrom(g, 'B')).toHaveLength(0);
  });

  it('removeEdge is immutable', () => {
    const g0 = sample();
    const g1 = removeEdge(g0, 'E1');
    expect(listEdges(g0)).toHaveLength(1);
    expect(listEdges(g1)).toHaveLength(0);
  });
});
