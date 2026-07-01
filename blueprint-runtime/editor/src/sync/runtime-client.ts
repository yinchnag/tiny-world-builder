/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/runtime-client（editor→runtime 高层客户端 · L-Sync · EX-5）
 * 职责：把 http-adapter(mirror+SSE) + mcp-client(工具调用) 组合成编辑器要用的门面：
 *       mirror(节点/边) · run(nodeId=触发执行) · subscribe(事件流)。
 * ─────────────────────────────────────────────────────────────
 */
import { createHttpAdapter } from './http-adapter';
import { createMcpClient } from './mcp-client';
import type { GraphChange, Unsubscribe } from './runtime-adapter';
import type { RuntimeEvent } from '@blueprint/core';

/** 编辑器侧 runtime 客户端。 */
export interface RuntimeClient {
  mirror(change: GraphChange): Promise<void>;
  run(nodeId: string): Promise<void>;
  subscribe(onEvent: (ev: RuntimeEvent) => void): Unsubscribe;
}

/**
 * 创建 runtime 客户端（对准某 baseUrl）。
 *
 * @param baseUrl runtime 服务基址
 * @param fetchFn fetch 实现（默认全局）
 * @returns RuntimeClient
 */
export function createRuntimeClient(baseUrl: string, fetchFn: typeof fetch = fetch): RuntimeClient {
  const adapter = createHttpAdapter(baseUrl, fetchFn);
  const client = createMcpClient(baseUrl, fetchFn);
  return {
    mirror: adapter.mirror,
    run: async (nodeId: string): Promise<void> => {
      await client.call('run_node', { nodeId });
    },
    subscribe: adapter.subscribe,
  };
}
