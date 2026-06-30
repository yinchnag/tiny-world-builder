/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/kernel/errors（运行时错误类型 + 稳定 code · L0）
 * 职责：真正的异常（编程错误）才 throw；可预期失败用 result。
 *
 * 注意：ERR.* 是 kernel 私有码（不跨 MCP 线）；跨线的拒绝/契约码在 core/events（§5.7）。
 * ─────────────────────────────────────────────────────────────
 */

/** kernel 私有稳定错误码。 */
export const ERR = {
  notFound: 'not_found',
  invalid: 'invalid',
  conflict: 'conflict',
  illegalTransition: 'illegal_transition',
  unauthorized: 'unauthorized',
} as const;

/** ERR 码类型。 */
export type ErrCode = (typeof ERR)[keyof typeof ERR];

/** 运行时错误（编程错误/真异常）；携带稳定 code。 */
export class RuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
  }
}
