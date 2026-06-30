/**
 * CACHE_CONTRACT 单测：C1–C7 + 注册（新增 CacheBypass）。
 */
import { describe, it, expect } from 'vitest';
import { CACHE_CONTRACT } from './cache';
import { validateContract, register, lookup } from '../registry';

describe('CACHE_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(CACHE_CONTRACT)).toEqual([]);
  });

  it('registers as an execution-family cache wrapper', () => {
    register(CACHE_CONTRACT);
    expect(lookup('cache')?.family).toBe('execution');
  });
});
