/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/kernel/clock（可注入时钟 · L0）
 * 职责：把"取当前时间"抽象成可注入接口，让事件时间戳在测试里可控（确定性）。
 * ─────────────────────────────────────────────────────────────
 */

/** 时钟接口：取 ISO 字符串与毫秒数。 */
export interface Clock {
  nowIso(): string;
  nowMs(): number;
}

/**
 * 真实时钟（包裹系统时间）。
 *
 * @returns 基于 Date 的 Clock
 */
export function createClock(): Clock {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

/**
 * 固定时钟（测试用，时间不流动）。
 *
 * @param iso 固定的 ISO 时间字符串
 * @returns 恒返回该时间的 Clock
 */
export function fixedClock(iso: string): Clock {
  const ms = new Date(iso).getTime();
  return { nowIso: () => iso, nowMs: () => ms };
}
