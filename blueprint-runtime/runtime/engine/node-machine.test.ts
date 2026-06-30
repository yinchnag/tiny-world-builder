/**
 * runtime/engine/node-machine 单测：合法转移产出事件；非法转移被拒（无副作用）。
 */
import { describe, it, expect } from 'vitest';
import { transition } from './node-machine';
import { createNode } from '../../core/graph/node';
import { fixedClock } from '../kernel/clock';
import type { NodeContract } from '../../core/contracts/registry';

const CONTRACT: NodeContract = {
  type: 'agent',
  family: 'execution',
  inputs: [],
  outputs: [],
  state: { values: ['idle', 'working', 'done'], initial: 'idle', transitions: [['idle', 'working', 'start'], ['working', 'done', 'finish']] },
  runtime: 'contex',
};
const CLOCK = fixedClock('2026-06-30T00:00:00.000Z');

describe('node-machine transition', () => {
  it('legal transition yields a node.transitioned event', () => {
    const r = transition(createNode({ id: 'A', type: 'agent', state: 'idle' }), CONTRACT, 'start', CLOCK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nextState).toBe('working');
      expect(r.value.event).toMatchObject({ eventType: 'node.transitioned', nodeId: 'A', payload: { from: 'idle', to: 'working', trigger: 'start' } });
    }
  });

  it('illegal transition is rejected with no event', () => {
    const r = transition(createNode({ id: 'A', type: 'agent', state: 'idle' }), CONTRACT, 'finish', CLOCK);
    expect(r.ok).toBe(false);
  });
});
