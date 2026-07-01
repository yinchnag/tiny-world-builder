/**
 * editor/src/state/ui-store（瞬态 UI · L-State）：检视器开合、连线被拒原因。
 */
import { create } from 'zustand';

/** 瞬态 UI 状态。 */
export interface UiState {
  inspectorOpen: boolean;
  connectReason: string | null;
  /** 节点 → 端口 → 最近收到的载荷（后端投递回流，检视器显示"产出/收到"）。 */
  lastDelivery: Record<string, Record<string, unknown>>;
  /** 节点 → 最近执行状态事件（exec.started/completed/failed）。 */
  execStatus: Record<string, string>;
  setInspectorOpen(open: boolean): void;
  setConnectReason(reason: string | null): void;
  recordDelivery(nodeId: string, portId: string, payload: unknown): void;
  recordExec(nodeId: string, status: string): void;
}

/** 瞬态 UI store。 */
export const useUiStore = create<UiState>((set) => ({
  inspectorOpen: false,
  connectReason: null,
  lastDelivery: {},
  execStatus: {},
  setInspectorOpen: (open: boolean): void => set({ inspectorOpen: open }),
  setConnectReason: (reason: string | null): void => set({ connectReason: reason }),
  recordDelivery: (nodeId: string, portId: string, payload: unknown): void =>
    set((s) => ({ lastDelivery: { ...s.lastDelivery, [nodeId]: { ...s.lastDelivery[nodeId], [portId]: payload } } })),
  recordExec: (nodeId: string, status: string): void => set((s) => ({ execStatus: { ...s.execStatus, [nodeId]: status } })),
}));
