/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/middleware（中间件组合器 · L5）
 * 职责：把工具 handler 包装成链 auth → 幂等 → ctx → handler（替代散落的 if/else）。
 *
 * compose([a,b,c], h) = a(b(c(h)))，执行顺序 a → b → c → h；
 * 任一中间件可短路（不调 next）。
 * ─────────────────────────────────────────────────────────────
 */

/** 工具调用请求。 */
export interface ToolRequest {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly meta?: { readonly idempotencyKey?: string; readonly correlationId?: string };
}

/** 工具调用结果（业务成功/失败都走 result，§5.8）。 */
export type ToolOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** 调用上下文（鉴权后注入）。 */
export interface HandlerCtx {
  readonly correlationId?: string;
  readonly scopes?: readonly string[];
}

/** 工具 handler。 */
export type Handler = (req: ToolRequest, ctx: HandlerCtx) => ToolOutcome;

/** 中间件：包裹 handler。 */
export type Middleware = (next: Handler) => Handler;

/**
 * 组合中间件链。
 *
 * @param middlewares 中间件数组（按声明顺序执行）
 * @param handler 最终域逻辑
 * @returns 组合后的 handler
 */
export function compose(middlewares: readonly Middleware[], handler: Handler): Handler {
  return middlewares.reduceRight<Handler>((next, mw) => mw(next), handler);
}
