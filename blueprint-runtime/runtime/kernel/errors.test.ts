/**
 * runtime/kernel/errors 单测：RuntimeError 携带 code。
 */
import { describe, it, expect } from 'vitest';
import { RuntimeError, ERR } from './errors';

describe('errors', () => {
  it('RuntimeError carries a stable code', () => {
    const e = new RuntimeError(ERR.notFound, 'gone');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('not_found');
    expect(e.name).toBe('RuntimeError');
  });
});
