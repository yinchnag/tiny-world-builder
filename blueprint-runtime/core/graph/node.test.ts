/**
 * core/graph/node 单测：构造默认值 + 不可变更新。
 */
import { describe, it, expect } from 'vitest';
import { createNode, withState, withProperties } from './node';

describe('graph node', () => {
  it('createNode defaults properties to empty', () => {
    const n = createNode({ id: 'A', type: 'agent', state: 'idle' });
    expect(n.properties).toEqual({});
    expect(n.view).toBeUndefined();
  });

  it('withState is immutable', () => {
    const n = createNode({ id: 'A', type: 'agent', state: 'idle' });
    const n2 = withState(n, 'working');
    expect(n.state).toBe('idle');
    expect(n2.state).toBe('working');
    expect(n2).not.toBe(n);
  });

  it('withProperties shallow-merges immutably', () => {
    const n = createNode({ id: 'A', type: 'agent', state: 'idle', properties: { model: 'opus' } });
    const n2 = withProperties(n, { temp: 1 });
    expect(n.properties).toEqual({ model: 'opus' });
    expect(n2.properties).toEqual({ model: 'opus', temp: 1 });
  });
});
