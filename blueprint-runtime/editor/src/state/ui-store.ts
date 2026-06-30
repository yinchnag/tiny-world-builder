/**
 * editor/src/state/ui-store（瞬态 UI · L-State）：检视器开合、连线被拒原因。
 */
import { create } from 'zustand';

/** 瞬态 UI 状态。 */
export interface UiState {
  inspectorOpen: boolean;
  connectReason: string | null;
  setInspectorOpen(open: boolean): void;
  setConnectReason(reason: string | null): void;
}

/** 瞬态 UI store。 */
export const useUiStore = create<UiState>((set) => ({
  inspectorOpen: false,
  connectReason: null,
  setInspectorOpen: (open: boolean): void => set({ inspectorOpen: open }),
  setConnectReason: (reason: string | null): void => set({ connectReason: reason }),
}));
