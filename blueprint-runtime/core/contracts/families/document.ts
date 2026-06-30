/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/document（Document 节点契约 · BP-1 · context 家族）
 * 职责：把文档声明为可见的上下文来源（node-evolution §1）。
 *       text_out / selection_out 均 context 泳道，且可赋给 ContextBundle，
 *       故可连 Agent.context_in（"文档喂 Agent 上下文"回路）。
 *       runtime=editor：文档内容由编辑器持有。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Document 节点契约（上下文来源：全文 + 选区）。 */
export const DOCUMENT_CONTRACT: NodeContract = {
  type: 'document',
  family: 'context',
  runtime: 'editor',
  inputs: [],
  outputs: [
    createPort({ id: 'text_out', dir: 'out', payloadType: 'DocumentText', lane: 'context', multiple: true }),
    createPort({ id: 'selection_out', dir: 'out', payloadType: 'DocumentSelection', lane: 'context', multiple: true }),
  ],
  state: {
    values: ['ready', 'edited'],
    initial: 'ready',
    transitions: [
      ['ready', 'edited', 'edit'],
      ['edited', 'ready', 'save'],
    ],
  },
};
