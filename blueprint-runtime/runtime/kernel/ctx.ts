/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/kernel/ctx（调用上下文传播 · L0）
 * 职责：在一次工具调用内隐式携带 correlationId/actor/workspace，
 *       替代每个 domain 函数手工穿 opts 参数（10 §3）。
 *
 * 实现：用 AsyncLocalStorage——异步链路里透明传递，零侵入。
 * ─────────────────────────────────────────────────────────────
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** 调用上下文。 */
export interface CallCtx {
  readonly correlationId: string;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly workspace?: string;
}

const storage = new AsyncLocalStorage<CallCtx>();

/**
 * 在给定上下文内执行 fn（同步或异步链路内 currentCtx() 可取到）。
 *
 * @param ctx 调用上下文
 * @param fn 要执行的函数
 * @returns fn 的返回值
 */
export function withCtx<T>(ctx: CallCtx, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * 取当前上下文（不在 withCtx 内时为 undefined）。
 *
 * @returns 当前 CallCtx 或 undefined
 */
export function currentCtx(): CallCtx | undefined {
  return storage.getStore();
}
