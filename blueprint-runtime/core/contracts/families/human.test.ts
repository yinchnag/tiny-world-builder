/**
 * HUMAN_CONTRACT 单测：C1–C7 元校验 + 注册（BP-1）。
 */
import { describe, it, expect } from 'vitest';
import { HUMAN_CONTRACT } from './human';
import { validateContract, register, lookup } from '../registry';

describe('HUMAN_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(HUMAN_CONTRACT)).toEqual([]);
  });

  it('registers as a human-family gate driven by the editor', () => {
    register(HUMAN_CONTRACT);
    expect(lookup('human_gate')?.family).toBe('human');
    expect(lookup('human_gate')?.runtime).toBe('editor');
  });
});
