/**
 * POLLY_CONTRACT 单测：C1–C7 + 注册（新增 PollySnapshot；复用 Task/HumanAttention）。
 */
import { describe, it, expect } from 'vitest';
import { POLLY_CONTRACT } from './polly';
import { validateContract, register, lookup } from '../registry';

describe('POLLY_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(POLLY_CONTRACT)).toEqual([]);
  });

  it('registers as an integration-family node', () => {
    register(POLLY_CONTRACT);
    expect(lookup('polly')?.family).toBe('integration');
    expect(lookup('polly')?.runtime).toBe('integration');
  });
});
