/**
 * runtime/kernel/result 单测：ok/fail/isOk。
 */
import { describe, it, expect } from 'vitest';
import { ok, fail, isOk } from './result';

describe('result', () => {
  it('ok wraps a value', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('fail carries code + message', () => {
    const r = fail('not_found', 'missing');
    expect(isOk(r)).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: 'not_found', message: 'missing' });
  });
});
