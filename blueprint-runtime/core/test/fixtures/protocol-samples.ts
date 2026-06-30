/**
 * ─────────────────────────────────────────────────────────────
 * 夹具：protocol-samples（前后端协议契约样本 · testing/00 §3.1 / 00 §5.8）
 * 职责：MCP 协议封套的标准样本（请求/result/error/SSE/resource），前后端共用。
 *       runtime 支断言 transport 接受/产出；editor 支断言 mcp-client 产出/解析。
 *
 * 冻结：契约冻结点产物。两支对同一份样本都绿 = 前后端不漂。
 * 仅导出常量数据 + 类型（无函数），不触发 G5 导出 JSDoc。
 * ─────────────────────────────────────────────────────────────
 */
import type { ReasonCode } from '../../events';

/** JSON-RPC 2.0 调用请求（00 §5.8）。 */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** 业务结果（成功/失败都走 result；§5.8）。 */
export type ToolResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: { readonly code: ReasonCode | string; readonly message: string } };

/** result 响应（业务层）。 */
export interface JsonRpcResultResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result: ToolResult;
}

/** 协议级错误响应（坏报文/鉴权/未知 method）。 */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** SSE 帧（id=seq / event=§5.6 词 / data=RuntimeEvent）。 */
export interface SseFrame {
  readonly id: number;
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** tools/call 请求样本。 */
export const REQ_CALL: JsonRpcRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'agent_report',
    arguments: { summary: 'done' },
    _meta: { idempotencyKey: 'idem-1', correlationId: 'corr-1' },
  },
};

/** 成功 result 样本。 */
export const RES_OK: JsonRpcResultResponse = { jsonrpc: '2.0', id: 1, result: { ok: true, value: { seq: 3 } } };

/** 业务失败 result 样本（code 取 §5.7）。 */
export const RES_FAIL: JsonRpcResultResponse = {
  jsonrpc: '2.0',
  id: 1,
  result: { ok: false, error: { code: 'payload.incompatible', message: 'AgentReport 不可赋给 HumanAttention' } },
};

/** 协议级错误样本（JSON-RPC error，数字码）。 */
export const ERR_PROTO: JsonRpcErrorResponse = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } };

/** SSE 帧样本（message.delivered）。 */
export const SSE_FRAME: SseFrame = {
  id: 3,
  event: 'message.delivered',
  data: { seq: 3, ts: '2026-06-30T00:00:00Z', eventType: 'message.delivered', edgeId: 'E1' },
};

/** resources/read 响应样本（投影视图，context:// 方案）。 */
export const RES_READ: JsonRpcResultResponse = {
  jsonrpc: '2.0',
  id: 2,
  result: { ok: true, value: { uri: 'context://ws/graph', nodes: [], edges: [] } },
};
