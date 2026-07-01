/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/server（runtime 服务组装 · L5 · EX-5）
 * 职责：把 persist + engine 执行器 + graph-tools + transport 组装成一个可监听的
 *       MCP 服务——Agent 执行器用 resolveProvider(env)（真 key 从服务端 env 取，D6）。
 *       编辑器经 HTTP+SSE 连它：镜像图 → run_node → 执行 → 事件回流。
 * ─────────────────────────────────────────────────────────────
 */
import type { Server } from 'node:http';
import { openDb, migrate } from '../persist/sqlite-adapter';
import { createSseHub, type SseHub } from './sse';
import { createToolRegistry } from './tools/registry';
import { registerGraphTools } from './tools/graph-tools';
import { createExecutorRegistry } from '../engine/exec/executor';
import { createAgentExecutor } from '../engine/exec/agent';
import { terminalExecutor } from '../engine/exec/terminal';
import { resolveProvider } from '../engine/exec/providers/registry';
import { createTransport } from './transport';
import { createClock } from '../kernel/clock';
import { registerBuiltinContracts } from '../../core/index';

/** 组装好的 runtime 服务（调用方 listen/close）。 */
export interface RuntimeServer {
  readonly server: Server;
  readonly hub: SseHub;
}

/**
 * 组装 runtime MCP 服务：内置契约 + Agent/Terminal 执行器 + 图工具 + transport。
 *
 * @param env 环境变量表（Agent provider 的 key 来源）
 * @returns RuntimeServer（server + hub）
 */
export function createRuntimeServer(env: Record<string, string | undefined>): RuntimeServer {
  registerBuiltinContracts();
  const db = openDb();
  migrate(db);
  const hub = createSseHub();
  const executors = createExecutorRegistry();
  executors.register('agent', createAgentExecutor((name) => resolveProvider(name, env)));
  executors.register('terminal', terminalExecutor);
  const registry = createToolRegistry();
  registerGraphTools(registry, { db, hub, clock: createClock(), executors });
  return { server: createTransport({ registry, middlewares: [], hub }), hub };
}
