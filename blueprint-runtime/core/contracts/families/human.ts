/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/human（Human Gate 节点契约 · BP-1 · human 家族）
 * 职责：把「人类介入」声明为图中显式的门（node-evolution §3）。
 *       与 Agent 闭环：Agent.human_attention_out → Human.question_in，
 *                      Human.reply_out → Agent.human_reply_in。
 *       runtime=editor：人类经编辑器 UI 应答，由前端负责跑。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Human Gate 节点契约（人类审批/输入门）。 */
export const HUMAN_CONTRACT: NodeContract = {
  type: 'human_gate',
  family: 'human',
  runtime: 'editor',
  inputs: [
    createPort({ id: 'question_in', dir: 'in', payloadType: 'HumanAttention', lane: 'human', multiple: true }),
  ],
  outputs: [
    createPort({ id: 'reply_out', dir: 'out', payloadType: 'HumanReply', lane: 'human' }),
    createPort({ id: 'approval_out', dir: 'out', payloadType: 'Approval', lane: 'human' }),
  ],
  state: {
    values: ['idle', 'awaiting', 'replied'],
    initial: 'idle',
    transitions: [
      ['idle', 'awaiting', 'ask'],
      ['awaiting', 'replied', 'reply'],
      ['replied', 'idle', 'reset'],
    ],
  },
};
