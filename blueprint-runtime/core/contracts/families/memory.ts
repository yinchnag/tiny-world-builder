/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/memory（Memory 节点契约 · BP-1 · context 家族）
 * 职责：把工作区记忆声明为上下文来源（node-evolution §1）。
 *       fact_out / proposal_out 均 context 泳道、可赋给 ContextBundle，
 *       故可连 Agent.context_in。runtime=editor：记忆面板由编辑器持有。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Memory 节点契约（记忆事实 + 提案）。 */
export const MEMORY_CONTRACT: NodeContract = {
  type: 'memory',
  family: 'context',
  runtime: 'editor',
  inputs: [],
  outputs: [
    createPort({ id: 'fact_out', dir: 'out', payloadType: 'MemoryFact', lane: 'context', multiple: true }),
    createPort({ id: 'proposal_out', dir: 'out', payloadType: 'MemoryProposal', lane: 'context', multiple: true }),
  ],
  state: {
    values: ['idle', 'proposing'],
    initial: 'idle',
    transitions: [
      ['idle', 'proposing', 'propose'],
      ['proposing', 'idle', 'commit'],
    ],
  },
};
