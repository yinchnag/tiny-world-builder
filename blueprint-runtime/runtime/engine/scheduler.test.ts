/**
 * runtime/engine/scheduler 单测：FIFO 就绪队列。
 */
import { describe, it, expect } from 'vitest';
import { createScheduler } from './scheduler';

describe('scheduler', () => {
  it('dequeues in FIFO order', () => {
    const s = createScheduler();
    s.enqueue('A');
    s.enqueue('B');
    expect(s.size()).toBe(2);
    expect(s.tick()).toBe('A');
    expect(s.tick()).toBe('B');
    expect(s.tick()).toBeUndefined();
  });
});
