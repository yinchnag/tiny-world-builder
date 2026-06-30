/**
 * runtime/persist/projections/nodes 单测：纯投影、忽略无关事件。
 */
import { describe, it, expect } from 'vitest';
import { nodesProjection } from './nodes';
import type { RuntimeEvent } from '../../../core/events';

function ev(partial: Partial<RuntimeEvent>): RuntimeEvent {
  return { seq: 1, ts: 't', eventType: 'node.transitioned', ...partial } as RuntimeEvent;
}

describe('nodesProjection', () => {
  it('projects node state from node.transitioned', () => {
    const s = nodesProjection.apply(ev({ nodeId: 'A', payload: { to: 'working' } }), nodesProjection.init());
    expect(s).toEqual({ A: 'working' });
  });

  it('ignores unrelated events and is pure (no mutation)', () => {
    const prev = { A: 'working' };
    const s = nodesProjection.apply(ev({ eventType: 'message.delivered', edgeId: 'E1' }), prev);
    expect(s).toBe(prev); // 无关事件原样返回
  });
});
