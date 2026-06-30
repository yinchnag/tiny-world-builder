/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/status（Status 节点契约 · 观察家族）
 * 职责：工作区聚合观察者（node-evolution §5）。本期产出受阻任务（task 泳道）。
 *       runtime=contex：后端 status-view 聚合。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Status 观察节点契约（发出受阻任务）。 */
export const STATUS_CONTRACT: NodeContract = {
  type: 'status',
  family: 'observation',
  runtime: 'contex',
  inputs: [],
  outputs: [
    createPort({ id: 'blocked_task_out', dir: 'out', payloadType: 'BlockedTask', lane: 'task', multiple: true }),
  ],
  state: {
    values: ['ok', 'blocked'],
    initial: 'ok',
    transitions: [
      ['ok', 'blocked', 'block'],
      ['blocked', 'ok', 'clear'],
    ],
  },
};
