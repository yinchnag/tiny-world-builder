// @vitest-environment jsdom
/**
 * InspectorPanel 渲染测试（jsdom · BP-3）：实时状态 + 动作按钮推进 + 端口。
 */
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { registerBuiltinContracts } from '@blueprint/core';
import { InspectorPanel } from './InspectorPanel';
import { useGraphStore } from '../state/graph-store';

beforeAll(() => registerBuiltinContracts());
beforeEach(() => {
  useGraphStore.setState({
    nodes: [{ id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } }],
    edges: [],
  });
});
afterEach(() => cleanup());

describe('InspectorPanel', () => {
  it('renders the selected node state and contract ports', () => {
    const { getByTestId, container } = render(<InspectorPanel nodeId="A" />);
    expect(getByTestId('inspector-state').textContent).toBe('idle');
    expect(container.querySelector('[data-port="message_in"]')).not.toBeNull();
    expect(container.querySelector('[data-port="report_out"]')).not.toBeNull();
  });

  it('action button advances the node state (有反馈)', () => {
    const { getByTestId } = render(<InspectorPanel nodeId="A" />);
    fireEvent.click(getByTestId('action-start'));
    expect(useGraphStore.getState().nodes[0].data.state).toBe('working');
    expect(getByTestId('inspector-state').textContent).toBe('working');
  });

  it('shows an empty state when nothing is selected', () => {
    const { getByTestId } = render(<InspectorPanel nodeId={null} />);
    expect(getByTestId('inspector-empty')).toBeTruthy();
  });
});
