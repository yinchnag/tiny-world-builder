/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/sse（事件推送中枢 · L5）
 * 职责：把 event-log 的事件扇出给订阅者；带环形缓冲支持 Last-Event-ID 重放。
 * ─────────────────────────────────────────────────────────────
 */
import type { RuntimeEvent } from '../../core/events';

/** SSE 事件中枢。 */
export interface SseHub {
  subscribe(onEvent: (ev: RuntimeEvent) => void): () => void;
  push(ev: RuntimeEvent): void;
  replaySince(seq: number): RuntimeEvent[];
}

/**
 * 创建内存事件中枢（环形缓冲用于断线重放）。
 *
 * @param bufferSize 缓冲事件数上限
 * @returns SseHub
 */
export function createSseHub(bufferSize = 1000): SseHub {
  const subscribers = new Set<(ev: RuntimeEvent) => void>();
  const ring: RuntimeEvent[] = [];
  return {
    subscribe(onEvent: (ev: RuntimeEvent) => void): () => void {
      subscribers.add(onEvent);
      return () => subscribers.delete(onEvent);
    },
    push(ev: RuntimeEvent): void {
      ring.push(ev);
      if (ring.length > bufferSize) ring.shift();
      for (const s of subscribers) s(ev);
    },
    replaySince: (seq: number): RuntimeEvent[] => ring.filter((e) => e.seq > seq),
  };
}

/**
 * 把一条 RuntimeEvent 格式化为 SSE 帧（id=seq / event=eventType / data=事件，§5.8）。
 *
 * @param ev 运行时事件
 * @returns SSE 帧结构
 */
export function toSseFrame(ev: RuntimeEvent): { id: number; event: string; data: RuntimeEvent } {
  return { id: ev.seq, event: ev.eventType, data: ev };
}
