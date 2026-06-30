/**
 * MEMORY_CONTRACT 单测：C1–C7 + 注册（新增 MemoryProposal 载荷类型）。
 */
import { describe, it, expect } from 'vitest';
import { MEMORY_CONTRACT } from './memory';
import { validateContract, register, lookup } from '../registry';

describe('MEMORY_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(MEMORY_CONTRACT)).toEqual([]);
  });

  it('registers as a context-family source', () => {
    register(MEMORY_CONTRACT);
    expect(lookup('memory')?.family).toBe('context');
  });
});
