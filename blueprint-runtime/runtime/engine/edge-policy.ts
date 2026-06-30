/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/edge-policy（边策略骨架 · L4）
 * 职责：投递前钩子——directed 反向校验 + retry/cancel/gate 钩子（地基留骨架）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Edge } from '../../core/graph/edge';
import { ok, fail, type Result } from '../kernel/result';
import { ERR } from '../kernel/errors';

/** 边策略：投递前对一条载荷应用策略。 */
export interface EdgePolicy {
  apply(edge: Edge, payload: unknown, fromNode: string): Result<unknown>;
}

/** 可注入的策略钩子（骨架；retry/cancel/gate 后续填）。 */
export interface PolicyHooks {
  onApply?: () => void;
}

/**
 * 默认边策略：directed 边只许 source→target（反向投递被拒）；钩子可注入。
 *
 * @param hooks 策略钩子（骨架）
 * @returns EdgePolicy
 */
export function createEdgePolicy(hooks: PolicyHooks = {}): EdgePolicy {
  return {
    apply(edge: Edge, payload: unknown, fromNode: string): Result<unknown> {
      if (edge.directed && fromNode === edge.target.node) {
        return fail(ERR.invalid, 'directed 边反向投递被拒');
      }
      hooks.onApply?.();
      return ok(payload);
    },
  };
}
