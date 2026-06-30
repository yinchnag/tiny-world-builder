/**
 * TASK_CONTRACT 单测：C1–C7 + 注册（零新增载荷类型）。
 */
import { describe, it, expect } from 'vitest';
import { TASK_CONTRACT } from './task';
import { validateContract, register, lookup } from '../registry';

describe('TASK_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(TASK_CONTRACT)).toEqual([]);
  });

  it('registers as a task-family node', () => {
    register(TASK_CONTRACT);
    expect(lookup('task')?.family).toBe('task');
  });
});
