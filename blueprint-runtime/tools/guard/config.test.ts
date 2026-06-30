/**
 * tools/guard/config 的镜像测试：锁定阈值与 30-guardrails 一致。
 */
import { describe, it, expect } from 'vitest';
import { THRESHOLDS, COVERAGE } from './config';

describe('guard config', () => {
  it('mirrors 30 §G2 size/complexity thresholds', () => {
    expect(THRESHOLDS).toEqual({
      maxLines: 500,
      maxLinesPerFunction: 100,
      maxParams: 5,
      maxDepth: 4,
      complexity: 15,
    });
  });

  it('mirrors 30 §G6 coverage thresholds', () => {
    expect(COVERAGE).toEqual({ global: 80, core: 90, ui: 70 });
  });
});
