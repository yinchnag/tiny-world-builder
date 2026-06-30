/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/types/payload-types（命名载荷类型 · 00 §5.1/§5.9）
 * 职责：定义命名载荷类型（lane + 字段级 Zod schema），并提供查询/lane 映射。
 *
 * 在分层中的位置（core 内部，最底层叶子）：
 *   validate / contracts / compatibility ──► 本模块（lane 与 schema 之源）
 *
 * 设计要点：
 *   - lane 是「连线泳道」的唯一来源；契约元校验 C3/C4 据此判定。
 *   - schema 用 Zod（§5.9）；地基阶段部分类型可留 null（结构校验后置）。
 *   - 纯数据 + 纯函数，零 I/O，平台中立（不碰 node:* 与 DOM）。
 * ─────────────────────────────────────────────────────────────
 */
import { z } from 'zod';

/** 六条泳道（00 §5.1）。 */
export type Lane = 'control' | 'message' | 'task' | 'context' | 'resource' | 'human';

/** 全部 lane 值（顺序仅供遍历/展示）。 */
export const LANES = ['control', 'message', 'task', 'context', 'resource', 'human'] as const;

/** 一个命名载荷类型：lane + 可选 Zod 字段 schema（§5.9）。 */
export interface PayloadType {
  readonly name: string;
  readonly lane: Lane;
  readonly description: string;
  readonly schema: z.ZodTypeAny | null;
}

interface Def {
  name: string;
  lane: Lane;
  description: string;
  schema?: z.ZodTypeAny;
}

function def(d: Def): PayloadType {
  return { name: d.name, lane: d.lane, description: d.description, schema: d.schema ?? null };
}

// 地基载荷类型（覆盖黄金夹具 + 常用）。功能阶段（BP）按需登记更多。
const TYPES: readonly PayloadType[] = [
  def({ name: 'AgentMessage', lane: 'message', description: 'Agent 间消息', schema: z.object({ text: z.string() }) }),
  def({ name: 'AgentReport', lane: 'message', description: 'Agent 结果报告', schema: z.object({ summary: z.string() }) }),
  def({ name: 'ChatMessage', lane: 'message', description: '聊天消息', schema: z.object({ text: z.string() }) }),
  def({ name: 'Task', lane: 'task', description: '任务', schema: z.object({ title: z.string() }) }),
  def({ name: 'TaskUpdate', lane: 'task', description: '任务更新' }),
  def({ name: 'Claim', lane: 'task', description: '认领' }),
  def({
    name: 'HandoffRequest',
    lane: 'task',
    description: 'Agent 交接请求（移交给某角色 + 理由）',
    schema: z.object({ targetRole: z.string(), reason: z.string() }),
  }),
  def({ name: 'ContextBundle', lane: 'context', description: '上下文包', schema: z.object({ items: z.array(z.string()) }) }),
  def({ name: 'DocumentSelection', lane: 'context', description: '文档选区', schema: z.object({ text: z.string() }) }),
  def({ name: 'DocumentText', lane: 'context', description: '文档全文', schema: z.object({ text: z.string() }) }),
  def({ name: 'MemoryFact', lane: 'context', description: '记忆事实' }),
  def({ name: 'MemoryProposal', lane: 'context', description: '记忆提案', schema: z.object({ proposal: z.string() }) }),
  def({ name: 'BrowserFinding', lane: 'context', description: '浏览器发现', schema: z.object({ finding: z.string() }) }),
  def({ name: 'GitDiff', lane: 'context', description: 'Git 差异', schema: z.object({ diff: z.string() }) }),
  def({ name: 'BlockedTask', lane: 'task', description: '受阻任务', schema: z.object({ taskId: z.string(), blocker: z.string() }) }),
  def({ name: 'HumanAttention', lane: 'human', description: '请求人类关注', schema: z.object({ question: z.string() }) }),
  def({ name: 'HumanReply', lane: 'human', description: '人类回复', schema: z.object({ text: z.string() }) }),
  def({ name: 'Approval', lane: 'human', description: '审批', schema: z.object({ approved: z.boolean() }) }),
  def({ name: 'CommandInput', lane: 'control', description: '终端命令输入', schema: z.object({ command: z.string() }) }),
  def({ name: 'ExitStatus', lane: 'control', description: '进程退出码', schema: z.object({ code: z.number() }) }),
  def({ name: 'StdoutChunk', lane: 'resource', description: '标准输出块', schema: z.object({ text: z.string() }) }),
  def({ name: 'StderrChunk', lane: 'resource', description: '标准错误块', schema: z.object({ text: z.string() }) }),
];

const REGISTRY: ReadonlyMap<string, PayloadType> = new Map(TYPES.map((t) => [t.name, t]));

/**
 * 查询命名载荷类型。
 *
 * @param name 类型名
 * @returns PayloadType 或 undefined（未注册）
 */
export function lookupPayloadType(name: string): PayloadType | undefined {
  return REGISTRY.get(name);
}

/**
 * 某载荷类型是否已注册。
 *
 * @param name 类型名
 * @returns 是否已注册
 */
export function isRegisteredPayloadType(name: string): boolean {
  return REGISTRY.has(name);
}

/**
 * 取某载荷类型的 lane。
 *
 * @param name 类型名
 * @returns lane 或 undefined
 */
export function laneOf(name: string): Lane | undefined {
  return REGISTRY.get(name)?.lane;
}

/**
 * 生成 payloadType → lane 的映射（契约元校验 C3/C4 用）。
 *
 * @returns 名称到 lane 的记录
 */
export function payloadLaneMap(): Record<string, Lane> {
  const out: Record<string, Lane> = {};
  for (const t of TYPES) out[t.name] = t.lane;
  return out;
}
