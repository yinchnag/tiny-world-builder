/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/exec/executor（节点执行器接缝 · L4 · EX-0）
 * 职责：定义"节点怎么干活"的接缝 + 注册表（type → 执行器）。
 *       执行器 async（命令/模型调用天然异步）；产出 = 出口 payloads + 状态 + 自定义事件。
 * ─────────────────────────────────────────────────────────────
 */
import type { Clock } from '../../kernel/clock';
import type { EventInput } from '../../persist/event-log';

/** 执行输入：节点 + 物化后的各 in 口载荷 + 时钟。 */
export interface ExecInput {
  readonly node: {
    readonly id: string;
    readonly type: string;
    readonly state: string;
    readonly properties: Readonly<Record<string, unknown>>;
  };
  readonly inputs: Readonly<Record<string, unknown[]>>;
  readonly clock: Clock;
}

/** 一条执行器输出（产到某 out 口）。 */
export interface ExecOutput {
  readonly port: string;
  readonly payload: unknown;
}

/** 执行结果：出口产出 + 可选下一状态 + 可选自定义事件。 */
export interface ExecResult {
  readonly outputs: readonly ExecOutput[];
  readonly nextState?: string;
  readonly events?: readonly EventInput[];
}

/** 节点执行器。 */
export type NodeExecutor = (input: ExecInput) => Promise<ExecResult>;

/** 执行器注册表（type → 执行器）。 */
export interface ExecutorRegistry {
  register(type: string, exec: NodeExecutor): void;
  lookup(type: string): NodeExecutor | undefined;
}

/**
 * 创建执行器注册表。
 *
 * @returns ExecutorRegistry
 */
export function createExecutorRegistry(): ExecutorRegistry {
  const map = new Map<string, NodeExecutor>();
  return {
    register: (type: string, exec: NodeExecutor): void => {
      map.set(type, exec);
    },
    lookup: (type: string): NodeExecutor | undefined => map.get(type),
  };
}
