/**
 * memoize 单测：精确记忆化（命中短路 / 键序规范化 / 节点隔离）。
 */
import { describe, it, expect } from 'vitest';
import { createMemo } from './memoize';
import { fixedClock } from '../kernel/clock';

const clock = fixedClock('2026-06-30T00:00:00.000Z');

describe('memoize (exact)', () => {
  it('miss then hit for identical input; compute runs once', () => {
    const memo = createMemo();
    let computes = 0;
    const r1 = memo.evaluate('A', { x: 1 }, () => { computes += 1; return 'v'; }, clock);
    const r2 = memo.evaluate('A', { x: 1 }, () => { computes += 1; return 'v2'; }, clock);
    expect(r1.hit).toBe(false);
    expect(r1.event.eventType).toBe('cache.miss');
    expect(r2.hit).toBe(true);
    expect(r2.event.eventType).toBe('cache.hit');
    expect(r2.result).toBe('v');
    expect(computes).toBe(1);
  });

  it('canonicalizes key order (same content, different key order = hit)', () => {
    const memo = createMemo();
    memo.evaluate('A', { a: 1, b: 2 }, () => 'v', clock);
    const r = memo.evaluate('A', { b: 2, a: 1 }, () => 'other', clock);
    expect(r.hit).toBe(true);
    expect(r.result).toBe('v');
  });

  it('different nodeId is a separate cache', () => {
    const memo = createMemo();
    memo.evaluate('A', { x: 1 }, () => 'a', clock);
    expect(memo.evaluate('B', { x: 1 }, () => 'b', clock).hit).toBe(false);
  });
});
