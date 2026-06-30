/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/validate（统一校验门面 · 00 §4）
 * 职责：canConnect（连接合法性）、validatePayload（载荷字段 §5.9）、
 *       validateGraph（图级：必填 in 口）。编辑期与运行期共用同一函数（00 §2.2）。
 *
 * 在分层中的位置（core 顶层门面）：
 *   editor/connection · runtime/message-bus ──► 本模块
 *   本模块 ──► types/compatibility · types/payload-types · graph/*
 *
 * 判定序（testing/00 §3）：
 *   port.not_found → direction.invalid → lane.mismatch → payload.incompatible → cardinality.exceeded
 * ─────────────────────────────────────────────────────────────
 */
import type { Port } from './graph/port';
import type { Graph } from './graph/graph';
import { listEdges } from './graph/graph';
import { checkCompatible } from './types/compatibility';
import { lookupPayloadType } from './types/payload-types';
import type { ReasonCode } from './events';

/** 校验结果：不通过时带 §5.7 原因码。 */
export interface CheckResult {
  readonly ok: boolean;
  readonly reason?: ReasonCode;
}

/** 连接选项：targetOccupied 表示目标 in 口已被占用（基数判定，调用方据图给出）。 */
export interface ConnectOpts {
  readonly targetOccupied?: boolean;
}

/**
 * 判定一条连接是否合法（编辑期 + 运行期同一函数）。
 *
 * @param source 源端口（应为 out）；undefined 表示端口未找到
 * @param target 目标端口（应为 in）；undefined 表示端口未找到
 * @param opts 选项；targetOccupied=true 且目标非 multiple 时报基数超
 * @returns 校验结果
 */
export function canConnect(
  source: Port | undefined,
  target: Port | undefined,
  opts: ConnectOpts = {},
): CheckResult {
  if (source === undefined || target === undefined) return { ok: false, reason: 'port.not_found' };
  if (source.dir !== 'out' || target.dir !== 'in') return { ok: false, reason: 'direction.invalid' };
  const compat = checkCompatible(source.payloadType, target.payloadType);
  if (!compat.ok) return { ok: false, reason: compat.reason };
  if (!target.multiple && (opts.targetOccupied ?? false)) return { ok: false, reason: 'cardinality.exceeded' };
  return { ok: true };
}

/**
 * 按 PayloadType 的 Zod schema 校验载荷字段（§5.9）。schema 为 null 时放行。
 *
 * @param typeName 载荷类型名
 * @param value 实际载荷
 * @returns 校验结果；不合 schema → payload.schema_invalid
 */
export function validatePayload(typeName: string, value: unknown): CheckResult {
  const pt = lookupPayloadType(typeName);
  if (pt === undefined) return { ok: false, reason: 'payload.incompatible' };
  if (pt.schema === null) return { ok: true };
  return pt.schema.safeParse(value).success ? { ok: true } : { ok: false, reason: 'payload.schema_invalid' };
}

/** 图级校验问题（可回指节点/端口）。 */
export interface GraphIssue {
  readonly reason: ReasonCode;
  readonly nodeId?: string;
  readonly portId?: string;
}

/** 取某节点类型的 in 端口（供 required 校验）。 */
export type ContractResolver = (nodeType: string) => { readonly inputs: readonly Port[] } | undefined;

/**
 * 图级校验：必填 in 口未连接 → required.unmet。
 *
 * 设计决定（2026-06-30）：运行期工作流**允许环**（重试/反馈回路是合法功能），
 * 故本函数不做环检测、§5.7 也不设环码。如需限制由具体节点/功能阶段处理。
 *
 * @param graph 图
 * @param getContract 节点类型 → 契约（取 inputs）
 * @returns 问题数组；空数组表示通过
 */
export function validateGraph(graph: Graph, getContract: ContractResolver): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const edges = listEdges(graph);
  for (const node of graph.nodes.values()) {
    const contract = getContract(node.type);
    if (contract === undefined) continue;
    for (const p of contract.inputs) {
      if (!p.required) continue;
      const connected = edges.some((e) => e.target.node === node.id && e.target.port === p.id);
      if (!connected) issues.push({ reason: 'required.unmet', nodeId: node.id, portId: p.id });
    }
  }
  return issues;
}
