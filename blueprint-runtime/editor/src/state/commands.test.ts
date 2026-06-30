/**
 * commands 单测：结构变更可撤销/重做（zundo）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from './graph-store';
import { undo, redo, clearHistory } from './commands';
import type { FlowNode } from '../lib/flow-types';

function node(id: string): FlowNode {
  return { id, type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } };
}

beforeEach(() => {
  useGraphStore.setState({ nodes: [], edges: [] });
  clearHistory();
});

describe('commands undo/redo', () => {
  it('undoes and redoes a structural change', () => {
    useGraphStore.getState().addNode(node('A'));
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodes).toHaveLength(0);
    redo();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });
});
