// @vitest-environment jsdom
/**
 * InspectorPanel 渲染测试（jsdom）：契约驱动渲染端口/状态（F6 验收）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { register, createPort } from '@blueprint/core';
import { InspectorPanel } from './InspectorPanel';

beforeAll(() => {
  register({
    type: 'agent',
    family: 'execution',
    inputs: [createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' })],
    outputs: [createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' })],
    state: { values: ['idle', 'working'], initial: 'idle', transitions: [] },
    runtime: 'contex',
  });
});
afterEach(() => cleanup());

describe('InspectorPanel', () => {
  it('renders ports and state from the contract', () => {
    const { container } = render(<InspectorPanel nodeType="agent" />);
    expect(container.querySelector('[data-port="message_in"]')).not.toBeNull();
    expect(container.querySelector('[data-port="report_out"]')).not.toBeNull();
  });

  it('shows an empty state when nothing is selected', () => {
    const { getByTestId } = render(<InspectorPanel nodeType={null} />);
    expect(getByTestId('inspector-empty')).toBeTruthy();
  });
});
