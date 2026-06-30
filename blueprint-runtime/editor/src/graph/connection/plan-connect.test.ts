/**
 * plan-connect 单测：兼容连线产 typed 边；不兼容带拒绝码。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltinContracts } from '@blueprint/core';
import { planConnection } from './plan-connect';
import type { FlowNode } from '../../lib/flow-types';

const NODES: FlowNode[] = [
  { id: 'D', type: 'document', position: { x: 0, y: 0 }, data: { state: 'ready', properties: {} } },
  { id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } },
];

describe('planConnection', () => {
  beforeAll(() => registerBuiltinContracts());

  it('plans a typed edge for a compatible connection (Document.selection_out → Agent.context_in)', () => {
    const plan = planConnection(
      { source: 'D', sourceHandle: 'selection_out', target: 'A', targetHandle: 'context_in' },
      NODES,
      'e1',
    );
    expect(plan.reason).toBeNull();
    expect(plan.edge?.type).toBe('typed');
    expect(plan.edge?.data?.lane).toBe('context');
    expect(plan.edge?.data?.payloadType).toBe('DocumentSelection');
  });

  it('rejects an incompatible connection with a reason (→ Agent.message_in = lane.mismatch)', () => {
    const plan = planConnection(
      { source: 'D', sourceHandle: 'selection_out', target: 'A', targetHandle: 'message_in' },
      NODES,
      'e2',
    );
    expect(plan.edge).toBeNull();
    expect(plan.reason).toBe('lane.mismatch');
  });
});
