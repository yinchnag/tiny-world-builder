/**
 * runtime/kernel/clock 单测：真实/固定时钟。
 */
import { describe, it, expect } from 'vitest';
import { createClock, fixedClock } from './clock';

describe('clock', () => {
  it('real clock returns ISO + ms', () => {
    const c = createClock();
    expect(typeof c.nowIso()).toBe('string');
    expect(typeof c.nowMs()).toBe('number');
  });

  it('fixed clock does not move', () => {
    const c = fixedClock('2026-06-30T00:00:00.000Z');
    expect(c.nowIso()).toBe('2026-06-30T00:00:00.000Z');
    expect(c.nowMs()).toBe(c.nowMs());
  });
});
