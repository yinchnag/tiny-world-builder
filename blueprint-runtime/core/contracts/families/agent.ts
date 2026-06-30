/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/agent（Agent 节点契约 · BP-1 · execution 家族）
 * 职责：声明 Agent 节点的端口/状态机/家族/执行归属（端口取自 node-evolution §2）。
 *       仅「声明」契约数据；注册由 families/index.registerBuiltinContracts 统一做。
 *
 * 端口全部使用已冻结的载荷类型（00 §5.1）：
 *   in : message_in(AgentMessage) · task_in(Task) · context_in(ContextBundle)
 *        · human_reply_in(HumanReply)
 *   out: message_out(AgentMessage) · report_out(AgentReport) · handoff_out(HandoffRequest)
 *        · human_attention_out(HumanAttention) · task_update_out(TaskUpdate)
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Agent 执行节点契约（typed 推理/执行节点）。 */
export const AGENT_CONTRACT: NodeContract = {
  type: 'agent',
  family: 'execution',
  runtime: 'contex',
  inputs: [
    createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message', multiple: true }),
    createPort({ id: 'task_in', dir: 'in', payloadType: 'Task', lane: 'task' }),
    createPort({ id: 'context_in', dir: 'in', payloadType: 'ContextBundle', lane: 'context', multiple: true }),
    createPort({ id: 'human_reply_in', dir: 'in', payloadType: 'HumanReply', lane: 'human' }),
  ],
  outputs: [
    createPort({ id: 'message_out', dir: 'out', payloadType: 'AgentMessage', lane: 'message', multiple: true }),
    createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' }),
    createPort({ id: 'handoff_out', dir: 'out', payloadType: 'HandoffRequest', lane: 'task' }),
    createPort({ id: 'human_attention_out', dir: 'out', payloadType: 'HumanAttention', lane: 'human' }),
    createPort({ id: 'task_update_out', dir: 'out', payloadType: 'TaskUpdate', lane: 'task' }),
  ],
  state: {
    values: ['idle', 'working', 'blocked', 'reporting', 'done'],
    initial: 'idle',
    transitions: [
      ['idle', 'working', 'start'],
      ['working', 'blocked', 'await_human'],
      ['blocked', 'working', 'human_replied'],
      ['working', 'reporting', 'report'],
      ['reporting', 'working', 'continue'],
      ['working', 'done', 'complete'],
    ],
  },
};
