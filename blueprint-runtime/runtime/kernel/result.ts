/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/kernel/result（统一返回包装 · L0）
 * 职责：可预期失败用 Result 显式返回，不靠抛异常控流（GUIDE §6）。
 * ─────────────────────────────────────────────────────────────
 */

/** 成功值或失败原因（code 稳定、可回指）。 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * 构造成功结果。
 *
 * @param value 成功值
 * @returns ok 结果
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * 构造失败结果。
 *
 * @param code 稳定错误码
 * @param message 人类可读信息
 * @returns fail 结果
 */
export function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/**
 * 类型守卫：是否成功。
 *
 * @param r 结果
 * @returns 是否 ok
 */
export function isOk<T>(r: Result<T>): r is { ok: true; value: T } {
  return r.ok;
}
