// @vitest-environment jsdom
/**
 * FlowCanvas 渲染测试（jsdom）：画布渲染 + store 节点出现（F4 验收）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import { useGraphStore } from '../state/graph-store';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => cleanup());

describe('FlowCanvas', () => {
  it('renders the canvas with a node from the store', () => {
    useGraphStore.setState({
      nodes: [{ id: 'A', type: 'default', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } }],
      edges: [],
    });
    const { container } = render(<FlowCanvas />);
    expect(container.querySelector('.react-flow')).not.toBeNull();
    expect(container.querySelector('[data-id="A"]')).not.toBeNull();
  });
});
