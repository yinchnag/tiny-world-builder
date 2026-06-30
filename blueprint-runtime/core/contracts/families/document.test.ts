/**
 * DOCUMENT_CONTRACT 单测：C1–C7 + 注册（新增 DocumentText 载荷类型）。
 */
import { describe, it, expect } from 'vitest';
import { DOCUMENT_CONTRACT } from './document';
import { validateContract, register, lookup } from '../registry';

describe('DOCUMENT_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(DOCUMENT_CONTRACT)).toEqual([]);
  });

  it('registers as a context-family source driven by the editor', () => {
    register(DOCUMENT_CONTRACT);
    expect(lookup('document')?.family).toBe('context');
    expect(lookup('document')?.runtime).toBe('editor');
  });
});
