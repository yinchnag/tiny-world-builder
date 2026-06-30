/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/polly（Polly 节点契约 · 集成家族）
 * 职责：把 Polly 注册表观察者声明为节点（node-evolution §6）。
 *       snapshot_in 收外部快照（resource）；item_task_out 复用 Task（→ Agent.task_in），
 *       human_attention_out 复用 HumanAttention（→ Human.question_in）。
 *       runtime=integration：Polly 自有调度器，本节点只观察/转译。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Polly 集成观察节点契约（快照入；任务/人类关注出，复用既有类型）。 */
export const POLLY_CONTRACT: NodeContract = {
  type: 'polly',
  family: 'integration',
  runtime: 'integration',
  inputs: [
    createPort({ id: 'snapshot_in', dir: 'in', payloadType: 'PollySnapshot', lane: 'resource', multiple: true }),
  ],
  outputs: [
    createPort({ id: 'item_task_out', dir: 'out', payloadType: 'Task', lane: 'task', multiple: true }),
    createPort({ id: 'human_attention_out', dir: 'out', payloadType: 'HumanAttention', lane: 'human', multiple: true }),
  ],
  state: {
    values: ['watching', 'syncing'],
    initial: 'watching',
    transitions: [
      ['watching', 'syncing', 'sync'],
      ['syncing', 'watching', 'done'],
    ],
  },
};
