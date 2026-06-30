/**
 * runtime/engine/edge-policy 单测：directed 反向拒 + 钩子可注入并被调用。
 */
import { describe, it, expect } from 'vitest';
import { createEdgePolicy } from './edge-policy';
import { createEdge } from '../../core/graph/edge';

const EDGE = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });

describe('edge-policy', () => {
  it('blocks reverse delivery on a directed edge', () => {
    const r = createEdgePolicy().apply(EDGE, { summary: 'x' }, 'B'); // B 是 target → 反向
    expect(r.ok).toBe(false);
  });

  it('passes forward delivery and invokes the injected hook', () => {
    let called = false;
    const r = createEdgePolicy({ onApply: () => { called = true; } }).apply(EDGE, { summary: 'x' }, 'A');
    expect(r.ok).toBe(true);
    expect(called).toBe(true);
  });
});
