/**
 * TERMINAL_CONTRACT 单测：C1–C7 + 注册（新增 control/resource 泳道类型）。
 */
import { describe, it, expect } from 'vitest';
import { TERMINAL_CONTRACT } from './terminal';
import { validateContract, register, lookup } from '../registry';

describe('TERMINAL_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(TERMINAL_CONTRACT)).toEqual([]);
  });

  it('registers as an execution-family node run by contex', () => {
    register(TERMINAL_CONTRACT);
    expect(lookup('terminal')?.family).toBe('execution');
    expect(lookup('terminal')?.runtime).toBe('contex');
  });
});
