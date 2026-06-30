/**
 * autosave 单测：防抖只触发一次。
 */
import { describe, it, expect, vi } from 'vitest';
import { createAutosave } from './autosave';

describe('autosave', () => {
  it('debounces multiple triggers into one save', () => {
    vi.useFakeTimers();
    let saves = 0;
    const a = createAutosave(() => {
      saves += 1;
    }, 500);
    a.trigger();
    a.trigger();
    vi.advanceTimersByTime(500);
    expect(saves).toBe(1);
    vi.useRealTimers();
  });
});
