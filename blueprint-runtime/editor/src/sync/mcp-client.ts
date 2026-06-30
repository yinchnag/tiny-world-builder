/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/mcp-client（浏览器 MCP 客户端 · L-Sync）
 * 职责：构造 JSON-RPC tools/call 请求、解析 result（封套照 00 §5.8）。
 *       集成前对 protocol-samples + mock 编码（真后端在 Fx）。
 * ─────────────────────────────────────────────────────────────
 */

/** §5.8 业务结果（成功/失败都走 result）。 */
export type ToolResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** MCP 客户端。 */
export interface McpClient {
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * 创建 MCP 客户端（fetch 可注入，便于测试）。
 *
 * @param baseUrl 后端基址
 * @param fetchFn fetch 实现（默认全局 fetch）
 * @returns McpClient
 */
export function createMcpClient(baseUrl: string, fetchFn: typeof fetch = fetch): McpClient {
  return {
    async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      const req = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
      const resp = await fetchFn(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      const json = (await resp.json()) as { result: ToolResult };
      return json.result;
    },
  };
}
