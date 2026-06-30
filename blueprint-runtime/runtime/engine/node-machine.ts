/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/node-machine（节点状态机推进 · L4）
 * 职责：用 core/state/machine 推进节点状态，合法转移产出 node.transitioned 事件。
 *
 * 在分层中的位置：
 *   scheduler ──► 本模块 ──► core/state/machine（判定转移）
 *                       └─► persist/event-log（产出的事件由调用方追加）
 *
 * 纯度：本模块不写库；产出 EventInput 交调用方 append（便于测试/编排）。
 * ─────────────────────────────────────────────────────────────
 */
import type { GraphNode } from '../../core/graph/node';
import type { NodeContract } from '../../core/contracts/registry';
import { nextState } from '../../core/state/machine';
import type { Clock } from '../kernel/clock';
import { ok, fail, type Result } from '../kernel/result';
import { ERR } from '../kernel/errors';
import type { EventInput } from '../persist/event-log';

/** 推进结果：新状态 + 待追加的 node.transitioned 事件。 */
export interface TransitionResult {
  readonly nextState: string;
  readonly event: EventInput;
}

/**
 * 按触发推进节点状态。合法 → 产出事件；非法 → fail（无副作用）。
 *
 * @param node 当前节点
 * @param contract 节点契约（含状态机）
 * @param trigger 触发名
 * @param clock 时钟（事件时间戳）
 * @returns ok(推进结果) | fail(非法转移)
 */
export function transition(
  node: GraphNode,
  contract: NodeContract,
  trigger: string,
  clock: Clock,
): Result<TransitionResult> {
  const to = nextState(contract.state, node.state, trigger);
  if (to === null) return fail(ERR.illegalTransition, `非法转移 ${node.state} --${trigger}-->`);
  return ok({
    nextState: to,
    event: {
      ts: clock.nowIso(),
      eventType: 'node.transitioned',
      nodeId: node.id,
      payload: { from: node.state, to, trigger },
    },
  });
}
