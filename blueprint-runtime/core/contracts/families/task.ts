/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/task（Task 节点契约 · BP-1 · task 家族）
 * 职责：把任务声明为图中可见节点（node-evolution §4）。
 *       与 Agent 闭环：Task.task_out → Agent.task_in，
 *                      Agent.task_update_out → Task.task_update_in。
 *       零新增载荷类型——Task / TaskUpdate 均为已冻结类型。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Task 节点契约（派发任务 + 收任务更新）。 */
export const TASK_CONTRACT: NodeContract = {
  type: 'task',
  family: 'task',
  runtime: 'contex',
  inputs: [
    createPort({ id: 'task_update_in', dir: 'in', payloadType: 'TaskUpdate', lane: 'task', multiple: true }),
  ],
  outputs: [
    createPort({ id: 'task_out', dir: 'out', payloadType: 'Task', lane: 'task', multiple: true }),
  ],
  state: {
    values: ['open', 'in_progress', 'blocked', 'done'],
    initial: 'open',
    transitions: [
      ['open', 'in_progress', 'start'],
      ['in_progress', 'blocked', 'block'],
      ['blocked', 'in_progress', 'unblock'],
      ['in_progress', 'done', 'complete'],
    ],
  },
};
