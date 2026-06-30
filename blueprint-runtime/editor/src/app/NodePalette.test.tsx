// @vitest-environment jsdom
/**
 * NodePalette 单测（jsdom）：点按钮在 store 新建对应类型节点。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette';
import { useGraphStore } from '../state/graph-store';

beforeEach(() => useGraphStore.setState({ nodes: [], edges: [] }));
afterEach(() => cleanup());

describe('NodePalette', () => {
  it('adds a typed node to the store when a palette button is clicked', () => {
    const { getByTestId } = render(<NodePalette />);
    fireEvent.click(getByTestId('palette-add-agent'));
    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('agent');
    expect(nodes[0].data.state).toBe('idle');
  });
});
