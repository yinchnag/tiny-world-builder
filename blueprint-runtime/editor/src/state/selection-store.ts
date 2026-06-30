/**
 * editor/src/state/selection-store（选择集 · L-State）。
 */
import { create } from 'zustand';

/** 选择集状态。 */
export interface SelectionState {
  selected: ReadonlySet<string>;
  select(id: string): void;
  toggle(id: string): void;
  clear(): void;
}

/** 选择集 store。 */
export const useSelectionStore = create<SelectionState>((set) => ({
  selected: new Set<string>(),
  select: (id: string): void => set({ selected: new Set([id]) }),
  toggle: (id: string): void =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),
  clear: (): void => set({ selected: new Set<string>() }),
}));
