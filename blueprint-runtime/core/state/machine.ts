/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/state/machine（数据驱动状态机 · 00 §4）
 * 职责：给定 transitions 表，判定 (from --trigger--> ?) 是否合法、求目标状态。
 *
 * 在分层中的位置：
 *   contracts（C5 校验）/ runtime/node-machine（推进）──► 本模块
 * ─────────────────────────────────────────────────────────────
 */

/** 数据驱动状态机定义。transition = [from, to, trigger]。 */
export interface StateMachineDef {
  readonly values: readonly string[];
  readonly initial: string;
  readonly transitions: ReadonlyArray<readonly [string, string, string]>;
}

/**
 * 求 (from, trigger) 的目标状态；无合法转移返回 null。
 *
 * @param sm 状态机定义
 * @param from 当前状态
 * @param trigger 触发
 * @returns 目标状态或 null
 */
export function nextState(sm: StateMachineDef, from: string, trigger: string): string | null {
  for (const [f, to, t] of sm.transitions) {
    if (f === from && t === trigger) return to;
  }
  return null;
}

/**
 * 是否存在合法转移。
 *
 * @param sm 状态机定义
 * @param from 当前状态
 * @param trigger 触发
 * @returns 是否可转移
 */
export function canTransition(sm: StateMachineDef, from: string, trigger: string): boolean {
  return nextState(sm, from, trigger) !== null;
}
