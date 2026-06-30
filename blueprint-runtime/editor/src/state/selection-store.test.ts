/**
 * selection-store 单测。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from './selection-store';

beforeEach(() => useSelectionStore.getState().clear());

describe('selection-store', () => {
  it('select replaces, toggle adds/removes, clear empties', () => {
    useSelectionStore.getState().select('A');
    expect([...useSelectionStore.getState().selected]).toEqual(['A']);
    useSelectionStore.getState().toggle('B');
    expect(useSelectionStore.getState().selected.has('B')).toBe(true);
    useSelectionStore.getState().toggle('B');
    expect(useSelectionStore.getState().selected.has('B')).toBe(false);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selected.size).toBe(0);
  });
});
