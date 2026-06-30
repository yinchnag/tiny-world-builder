/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/types/compatibility（类型相容判定 · 00 §4）
 * 职责：判定「out 端口载荷类型 → in 端口载荷类型」是否相容，并给出 §5.7 原因码。
 *
 * 在分层中的位置：
 *   validate.canConnect ──► 本模块（类型维度：lane 一致 + 类型可赋）
 *                      └─► payload-types（取 lane）
 *
 * 设计要点（判定序见 testing/00 §3）：
 *   - lane 不同        → lane.mismatch
 *   - lane 同、可赋     → 相容（可赋 = 同类型 或在 ASSIGNABLE 表）
 *   - lane 同、不可赋   → payload.incompatible
 *   - 端口/方向/基数不在本模块（属图维度，见 validate.ts）。
 * ─────────────────────────────────────────────────────────────
 */
import { laneOf } from './payload-types';
import type { ReasonCode } from '../events';

/** out 类型 → 可赋的 in 类型集合（同类型恒可赋，不必列入；地基 = E1/E2）。 */
const ASSIGNABLE: Readonly<Record<string, readonly string[]>> = {
  AgentReport: ['AgentMessage'],
  DocumentSelection: ['ContextBundle'],
};

/** 相容判定结果；不相容时带 §5.7 原因码。 */
export interface CompatResult {
  readonly ok: boolean;
  readonly reason?: ReasonCode;
}

/**
 * 判定 out 载荷类型能否赋给 in 载荷类型（lane 一致 + 类型可赋）。
 *
 * @param outType out 端口载荷类型名
 * @param inType in 端口载荷类型名
 * @returns 相容结果；不相容带 lane.mismatch 或 payload.incompatible
 */
export function checkCompatible(outType: string, inType: string): CompatResult {
  const outLane = laneOf(outType);
  const inLane = laneOf(inType);
  // 未注册类型当作不可赋（正常流程里类型应已注册；此处兜底）。
  if (outLane === undefined || inLane === undefined) return { ok: false, reason: 'payload.incompatible' };
  if (outLane !== inLane) return { ok: false, reason: 'lane.mismatch' };
  if (outType === inType) return { ok: true };
  if (ASSIGNABLE[outType]?.includes(inType) ?? false) return { ok: true };
  return { ok: false, reason: 'payload.incompatible' };
}
