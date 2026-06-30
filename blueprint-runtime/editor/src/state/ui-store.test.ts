/**
 * ui-store 单测。
 */
import { describe, it, expect } from 'vitest';
import { useUiStore } from './ui-store';

describe('ui-store', () => {
  it('toggles inspector and records connect reason', () => {
    useUiStore.getState().setInspectorOpen(true);
    expect(useUiStore.getState().inspectorOpen).toBe(true);
    useUiStore.getState().setConnectReason('lane.mismatch');
    expect(useUiStore.getState().connectReason).toBe('lane.mismatch');
  });
});
