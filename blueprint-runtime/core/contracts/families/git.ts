/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/git（Git 节点契约 · 观察家族）
 * 职责：把仓库观察声明为节点（node-evolution §5）。
 *       diff_out 走 context 且可赋 ContextBundle → 可喂 Agent.context_in。
 *       runtime=contex：后端 Git 助手产出。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Git 观察节点契约（发出 diff）。 */
export const GIT_CONTRACT: NodeContract = {
  type: 'git',
  family: 'observation',
  runtime: 'contex',
  inputs: [],
  outputs: [
    createPort({ id: 'diff_out', dir: 'out', payloadType: 'GitDiff', lane: 'context', multiple: true }),
  ],
  state: {
    values: ['clean', 'dirty'],
    initial: 'clean',
    transitions: [
      ['clean', 'dirty', 'change'],
      ['dirty', 'clean', 'commit'],
    ],
  },
};
