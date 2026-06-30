/**
 * BROWSER_CONTRACT 单测：C1–C7 + 注册（新增 BrowserFinding）。
 */
import { describe, it, expect } from 'vitest';
import { BROWSER_CONTRACT } from './browser';
import { validateContract, register, lookup } from '../registry';

describe('BROWSER_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(BROWSER_CONTRACT)).toEqual([]);
  });

  it('registers as an observation-family node', () => {
    register(BROWSER_CONTRACT);
    expect(lookup('browser')?.family).toBe('observation');
  });
});
