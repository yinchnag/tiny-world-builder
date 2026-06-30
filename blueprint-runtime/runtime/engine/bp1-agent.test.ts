/**
 * BP-1 引擎兼容：node-machine 用 AGENT_CONTRACT 推进 Agent 状态机（契约 ↔ 引擎闭合）。
 * 证明 BP-1 落的契约不是纸面数据，而能直接驱动 F2 引擎。
 */
import { describe, it, expect } from 'vitest';
import { transition } from './node-machine';
import { AGENT_CONTRACT } from '../../core/contracts/families/agent';
import { createNode, withState } from '../../core/graph/node';
import { fixedClock } from '../kernel/clock';

describe('BP-1 agent contract drives the engine', () => {
  it('advances idle → working → reporting → working → done via node-machine', () => {
    const clock = fixedClock('2026-06-30T00:00:00.000Z');
    let node = createNode({ id: 'A', type: 'agent', state: AGENT_CONTRACT.state.initial });

    const r1 = transition(node, AGENT_CONTRACT, 'start', clock);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.nextState).toBe('working');
    expect(r1.value.event.eventType).toBe('node.transitioned');
    node = withState(node, r1.value.nextState);

    const r2 = transition(node, AGENT_CONTRACT, 'report', clock);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    node = withState(node, r2.value.nextState);
    expect(node.state).toBe('reporting');

    const r3 = transition(node, AGENT_CONTRACT, 'continue', clock);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    node = withState(node, r3.value.nextState);
    expect(node.state).toBe('working');

    const r4 = transition(node, AGENT_CONTRACT, 'complete', clock);
    expect(r4.ok).toBe(true);
    if (r4.ok) expect(r4.value.nextState).toBe('done');
  });

  it('rejects an illegal transition (complete straight from idle)', () => {
    const clock = fixedClock('2026-06-30T00:00:00.000Z');
    const node = createNode({ id: 'A', type: 'agent', state: 'idle' });
    expect(transition(node, AGENT_CONTRACT, 'complete', clock).ok).toBe(false);
  });
});
