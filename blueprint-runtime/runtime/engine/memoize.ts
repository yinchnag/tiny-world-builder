/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/memoize（精确记忆化 · L4 · BP Cache tier-1）
 * 职责：按「节点 + 输入哈希」缓存计算结果——命中短路返回、未命中计算并存。
 *       确定性、零正确性风险（vision §7 tier-1）。命中/未命中产出 cache.hit/cache.miss
 *       事件（EventInput，交调用方 append/push，可审计）。语义缓存属 tier-2，另议。
 * ─────────────────────────────────────────────────────────────
 */
import type { Clock } from '../kernel/clock';
import type { EventInput } from '../persist/event-log';

/** 一次记忆化评估的结果。 */
export interface MemoResult {
  readonly hit: boolean;
  readonly result: unknown;
  /** cache.hit 或 cache.miss 事件。 */
  readonly event: EventInput;
}

/** 精确记忆化器（内存缓存，按 key 隔离）。 */
export interface Memo {
  evaluate(nodeId: string, input: unknown, compute: () => unknown, clock: Clock): MemoResult;
}

// 规范化序列化（对象键排序）：同内容不同键序 → 命中同一缓存（内部辅助）。
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * 创建精确记忆化器。
 *
 * @returns Memo
 */
export function createMemo(): Memo {
  const store = new Map<string, unknown>();
  return {
    evaluate: (nodeId: string, input: unknown, compute: () => unknown, clock: Clock): MemoResult => {
      const key = `${nodeId}::${canonical(input)}`;
      if (store.has(key)) {
        return { hit: true, result: store.get(key), event: { ts: clock.nowIso(), eventType: 'cache.hit', nodeId, payload: { key } } };
      }
      const result = compute();
      store.set(key, result);
      return { hit: false, result, event: { ts: clock.nowIso(), eventType: 'cache.miss', nodeId, payload: { key } } };
    },
  };
}
