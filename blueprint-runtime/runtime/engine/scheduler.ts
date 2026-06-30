/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/scheduler（调度器 · L4）
 * 职责：决定下一步推进哪个节点。地基阶段：简单 FIFO 就绪队列。
 *       并发/优先级留功能阶段（10 §10 开放问题）。
 * ─────────────────────────────────────────────────────────────
 */

/** 就绪队列调度器。 */
export interface Scheduler {
  enqueue(nodeId: string): void;
  tick(): string | undefined;
  size(): number;
}

/**
 * 创建一个 FIFO 就绪队列调度器。
 *
 * @returns Scheduler
 */
export function createScheduler(): Scheduler {
  const queue: string[] = [];
  return {
    enqueue: (nodeId: string): void => {
      queue.push(nodeId);
    },
    tick: (): string | undefined => queue.shift(),
    size: (): number => queue.length,
  };
}
