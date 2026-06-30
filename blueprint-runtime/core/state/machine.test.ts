/**
 * core/state/machine 单测：合法/非法转移。
 */
import { describe, it, expect } from 'vitest';
import { nextState, canTransition, type StateMachineDef } from './machine';

const SM: StateMachineDef = {
  values: ['idle', 'working', 'done'],
  initial: 'idle',
  transitions: [
    ['idle', 'working', 'start'],
    ['working', 'done', 'finish'],
  ],
};

describe('state machine', () => {
  it('returns target for a legal transition', () => {
    expect(nextState(SM, 'idle', 'start')).toBe('working');
    expect(canTransition(SM, 'working', 'finish')).toBe(true);
  });

  it('returns null / false for an illegal transition', () => {
    expect(nextState(SM, 'idle', 'finish')).toBeNull();
    expect(canTransition(SM, 'done', 'start')).toBe(false);
  });
});
