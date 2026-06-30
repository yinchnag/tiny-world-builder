/**
 * ─────────────────────────────────────────────────────────────
 * 夹具：golden-graph（共享黄金夹具 · testing/00 §3）
 * 职责：唯一标准图 + 端口 + 正/反例对 + 标准事件序列，前后端测试共用。
 *
 * 冻结：契约冻结点产物。改动属动验收基线 → 走停-问（execution/00 §3）。
 * 仅导出常量数据（无函数），故不触发 G5 导出 JSDoc 要求。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import { createNode } from '../../graph/node';
import { createEdge } from '../../graph/edge';
import { emptyGraph, addNode, addEdge, type Graph } from '../../graph/graph';
import type { ReasonCode } from '../../events';

/** 标准端口（testing/00 §3 的 A/B/D/H 节点端口）。 */
export const PORTS = {
  report_out: createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' }),
  message_out: createPort({ id: 'message_out', dir: 'out', payloadType: 'AgentMessage', lane: 'message' }),
  message_in: createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' }),
  context_in: createPort({ id: 'context_in', dir: 'in', payloadType: 'ContextBundle', lane: 'context' }),
  selection_out: createPort({ id: 'selection_out', dir: 'out', payloadType: 'DocumentSelection', lane: 'context' }),
  question_in: createPort({ id: 'question_in', dir: 'in', payloadType: 'HumanAttention', lane: 'human' }),
  reply_out: createPort({ id: 'reply_out', dir: 'out', payloadType: 'HumanReply', lane: 'human' }),
} as const;

/** 标准图：A/B(agent) · D(document) · H(human) + 合法边 E1/E2。 */
export const GOLDEN_GRAPH: Graph = (() => {
  let g = emptyGraph();
  g = addNode(g, createNode({ id: 'A', type: 'agent', state: 'idle' }));
  g = addNode(g, createNode({ id: 'B', type: 'agent', state: 'idle' }));
  g = addNode(g, createNode({ id: 'D', type: 'document', state: 'idle' }));
  g = addNode(g, createNode({ id: 'H', type: 'human', state: 'idle' }));
  g = addEdge(g, createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' }));
  g = addEdge(g, createEdge({ id: 'E2', source: { node: 'D', port: 'selection_out' }, target: { node: 'A', port: 'context_in' }, lane: 'context', payloadType: 'DocumentSelection' }));
  return g;
})();

/** 正例对（canConnect 应 ok）。 */
export const POSITIVE_PAIRS = [
  { name: 'E1', source: PORTS.report_out, target: PORTS.message_in },
  { name: 'E2', source: PORTS.selection_out, target: PORTS.context_in },
] as const;

/** 反例对（canConnect 应给对应 §5.7 码）。 */
export const NEGATIVE_PAIRS: ReadonlyArray<{ name: string; source: typeof PORTS[keyof typeof PORTS]; target: typeof PORTS[keyof typeof PORTS]; reason: ReasonCode }> = [
  { name: 'X1', source: PORTS.reply_out, target: PORTS.question_in, reason: 'payload.incompatible' },
  { name: 'X3', source: PORTS.selection_out, target: PORTS.message_in, reason: 'lane.mismatch' },
];

/** 标准事件序列（喂投影/总线/SSE 测试；事件名取自 00 §5.6）。 */
export const EVENT_SEQUENCE = [
  { seq: 1, eventType: 'node.transitioned', nodeId: 'A', payload: { from: 'idle', to: 'working', trigger: 'start' } },
  { seq: 2, eventType: 'message.sent', nodeId: 'A', portId: 'report_out', payloadType: 'AgentReport' },
  { seq: 3, eventType: 'message.delivered', edgeId: 'E1' },
  { seq: 4, eventType: 'message.rejected', edgeId: 'X1', payload: { reason: 'payload.incompatible' } },
] as const;
