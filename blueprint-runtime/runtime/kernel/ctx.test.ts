/**
 * runtime/kernel/ctx 单测：上下文在调用内可取、外部为空。
 */
import { describe, it, expect } from 'vitest';
import { withCtx, currentCtx } from './ctx';

describe('ctx', () => {
  it('propagates within withCtx and is empty outside', () => {
    expect(currentCtx()).toBeUndefined();
    const seen = withCtx({ correlationId: 'corr-1', actorId: 'A' }, () => currentCtx());
    expect(seen?.correlationId).toBe('corr-1');
    expect(currentCtx()).toBeUndefined();
  });

  it('propagates across an await boundary', async () => {
    const seen = await withCtx({ correlationId: 'corr-2' }, async () => {
      await Promise.resolve();
      return currentCtx();
    });
    expect(seen?.correlationId).toBe('corr-2');
  });
});
