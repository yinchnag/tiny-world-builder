/**
 * lane-color 单测：每条 lane 有稳定颜色。
 */
import { describe, it, expect } from 'vitest';
import { laneColor } from './lane-color';
import { LANES } from '@blueprint/core';

describe('laneColor', () => {
  it('returns a distinct color per lane', () => {
    expect(laneColor('message')).toBe('#3b82f6');
    const colors = LANES.map((l) => laneColor(l));
    expect(new Set(colors).size).toBe(LANES.length);
  });
});
