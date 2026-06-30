/**
 * STATUS_CONTRACT 单测：C1–C7 + 注册（新增 BlockedTask）。
 */
import { describe, it, expect } from 'vitest';
import { STATUS_CONTRACT } from './status';
import { validateContract, register, lookup } from '../registry';

describe('STATUS_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(STATUS_CONTRACT)).toEqual([]);
  });

  it('registers as an observation-family aggregate', () => {
    register(STATUS_CONTRACT);
    expect(lookup('status')?.family).toBe('observation');
  });
});
