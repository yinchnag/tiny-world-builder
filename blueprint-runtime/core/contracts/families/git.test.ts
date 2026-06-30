/**
 * GIT_CONTRACT 单测：C1–C7 + 注册（新增 GitDiff）。
 */
import { describe, it, expect } from 'vitest';
import { GIT_CONTRACT } from './git';
import { validateContract, register, lookup } from '../registry';

describe('GIT_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(GIT_CONTRACT)).toEqual([]);
  });

  it('registers as an observation-family node run by contex', () => {
    register(GIT_CONTRACT);
    expect(lookup('git')?.family).toBe('observation');
    expect(lookup('git')?.runtime).toBe('contex');
  });
});
