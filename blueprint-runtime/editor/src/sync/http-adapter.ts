/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/http-adapter（真后端适配器 · L-Sync · BP-2 收尾）
 * 职责：实现 RuntimeAdapter 对接真 runtime——
 *   mirror   ：把节点/边经 MCP tools/call（create_node/create_edge）镜像到后端
 *   subscribe：以 fetch 流读 /mcp/sse，解析帧 → RuntimeEvent（node+browser 通用，免 EventSource）
 * 离线时改用 createNoopAdapter；本适配器仅在配置了 baseUrl 时启用。
 * ─────────────────────────────────────────────────────────────
 */
import type { RuntimeEvent } from '@blueprint/core';
import type { RuntimeAdapter, GraphChange, Unsubscribe } from './runtime-adapter';

// 解析 SSE 文本缓冲，对每个完整帧的 data 行回调；返回未消费的尾部（内部辅助）。
function drainFrames(buffer: string, onEvent: (ev: RuntimeEvent) => void): string {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const frame of parts) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine === undefined) continue;
    try {
      onEvent(JSON.parse(dataLine.slice('data:'.length).trim()) as RuntimeEvent);
    } catch {
      // 跳过坏帧
    }
  }
  return rest;
}

/**
 * 创建基于 HTTP/MCP 的真后端适配器。
 *
 * @param baseUrl 后端基址（如 http://127.0.0.1:8787）
 * @param fetchFn fetch 实现（默认全局；测试可注入）
 * @returns RuntimeAdapter
 */
export function createHttpAdapter(baseUrl: string, fetchFn: typeof fetch = fetch): RuntimeAdapter {
  async function callTool(name: string, args: Record<string, unknown>): Promise<void> {
    await fetchFn(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
  }
  return {
    mirror: async (change: GraphChange): Promise<void> => {
      const tool = change.kind === 'node' ? 'create_node' : 'create_edge';
      await callTool(tool, change.payload as Record<string, unknown>);
    },
    subscribe: (onEvent: (ev: RuntimeEvent) => void): Unsubscribe => {
      const ctrl = new AbortController();
      void (async (): Promise<void> => {
        try {
          const resp = await fetchFn(`${baseUrl}/mcp/sse`, { signal: ctrl.signal });
          if (resp.body === null) return;
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf = drainFrames(buf + decoder.decode(value, { stream: true }), onEvent);
          }
        } catch {
          // 连接失败(离线)或 abort(取消订阅)：静默结束
        }
      })();
      return (): void => ctrl.abort();
    },
  };
}
