/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/transport（HTTP + JSON-RPC + SSE 传输 · L5）
 * 职责：POST /mcp 走 JSON-RPC 工具调用；GET /mcp/sse 订阅事件流。
 *       封套形状以 00 §5.8 为准（本层只管实现）。
 *
 * dispatch（纯逻辑）与 createTransport（HTTP 绑定）分离，便于单测。
 * ─────────────────────────────────────────────────────────────
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { compose, type Middleware, type ToolOutcome, type ToolRequest } from './middleware';
import type { ToolRegistry } from './tools/registry';
import { toSseFrame, type SseHub } from './sse';

/** JSON-RPC 请求（00 §5.8）。 */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
    readonly _meta?: { readonly idempotencyKey?: string; readonly correlationId?: string };
  };
}

/** JSON-RPC 响应（result=业务结果；error=协议级错误）。 */
export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: ToolOutcome;
  readonly error?: { readonly code: number; readonly message: string };
}

function protoError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * 派发一个 JSON-RPC tools/call 请求到注册的 handler（纯逻辑，不依赖 HTTP）。
 *
 * @param registry 工具注册表
 * @param middlewares 中间件链
 * @param req JSON-RPC 请求
 * @returns JSON-RPC 响应
 */
export function dispatch(registry: ToolRegistry, middlewares: readonly Middleware[], req: JsonRpcRequest): JsonRpcResponse {
  if (req.method !== 'tools/call') return protoError(req.id, -32601, 'Method not found');
  const name = req.params?.name;
  if (name === undefined) return protoError(req.id, -32602, 'Missing tool name');
  const def = registry.lookup(name);
  if (def === undefined) return protoError(req.id, -32602, `Unknown tool: ${name}`);
  const toolReq: ToolRequest = { name, arguments: req.params?.arguments ?? {}, meta: req.params?._meta };
  const outcome = compose(middlewares, def.handler)(toolReq, { correlationId: req.params?._meta?.correlationId });
  return { jsonrpc: '2.0', id: req.id, result: outcome };
}

/** transport 依赖。 */
export interface TransportDeps {
  readonly registry: ToolRegistry;
  readonly middlewares: readonly Middleware[];
  readonly hub: SseHub;
}

function handlePost(req: IncomingMessage, res: ServerResponse, deps: TransportDeps): void {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => {
    chunks.push(c);
  });
  req.on('end', () => {
    let response: JsonRpcResponse;
    try {
      response = dispatch(deps.registry, deps.middlewares, JSON.parse(Buffer.concat(chunks).toString()) as JsonRpcRequest);
    } catch {
      response = protoError(null, -32700, 'Parse error');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
}

function handleSse(req: IncomingMessage, res: ServerResponse, deps: TransportDeps): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.flushHeaders(); // 立即下发响应头，否则客户端 fetch 在收到首帧前不会 resolve（与"连上再推"形成死锁）
  const unsub = deps.hub.subscribe((ev) => {
    const f = toSseFrame(ev);
    res.write(`id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`);
  });
  req.on('close', () => {
    unsub();
  });
}

/**
 * 创建 HTTP 传输：POST /mcp（JSON-RPC）/ GET /mcp/sse（SSE）。
 *
 * @param deps 注册表 + 中间件 + 事件中枢
 * @returns node http Server（调用方 listen/close）
 */
export function createTransport(deps: TransportDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/mcp') {
      handlePost(req, res, deps);
      return;
    }
    if (req.method === 'GET' && req.url === '/mcp/sse') {
      handleSse(req, res, deps);
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
