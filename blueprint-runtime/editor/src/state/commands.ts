/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/state/commands（命令/撤销 · L-State）
 * 职责：结构变更经 store 动作；本模块提供撤销/重做（zundo temporal）。
 *       与后端事件溯源同构（前端命令 ≈ 后端事件）。
 * ─────────────────────────────────────────────────────────────
 */
import { useGraphStore } from './graph-store';

/**
 * 撤销上一个结构变更。
 *
 * @returns void
 */
export function undo(): void {
  useGraphStore.temporal.getState().undo();
}

/**
 * 重做。
 *
 * @returns void
 */
export function redo(): void {
  useGraphStore.temporal.getState().redo();
}

/**
 * 清空撤销历史。
 *
 * @returns void
 */
export function clearHistory(): void {
  useGraphStore.temporal.getState().clear();
}
