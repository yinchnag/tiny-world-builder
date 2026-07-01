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

  it('records deliveries and exec status per node (EX-5)', () => {
    useUiStore.getState().recordDelivery('B', 'message_in', { summary: 'hi' });
    useUiStore.getState().recordExec('A', 'exec.completed');
    expect(useUiStore.getState().lastDelivery.B.message_in).toEqual({ summary: 'hi' });
    expect(useUiStore.getState().execStatus.A).toBe('exec.completed');
  });
});
