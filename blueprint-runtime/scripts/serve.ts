/**
 * ─────────────────────────────────────────────────────────────
 * runtime 服务入口：起 MCP 服务供网页蓝图连接（EX-5 联跑）。tsx 直跑。
 *
 * 用法（PowerShell）：
 *   $env:DEEPSEEK_API_KEY="sk-xxx"; pnpm serve
 *   $env:PORT="8787"; pnpm serve       # 端口默认 8787
 * 然后另开一个窗口 `pnpm --filter @blueprint/editor dev` 起网页(5173)，
 * 在检视器给 Agent 选 provider/model、点"运行"。
 * ─────────────────────────────────────────────────────────────
 */
import { createRuntimeServer } from '../runtime/mcp/server';

const port = Number(process.env.PORT ?? 8787);
const { server } = createRuntimeServer(process.env);
server.listen(port, '127.0.0.1', () => {
  console.log(`▶ runtime MCP 服务 → http://127.0.0.1:${port}/mcp（SSE: /mcp/sse）`);
  console.log('  网页 dev 用 VITE_RUNTIME_URL 指向它（默认已指 127.0.0.1:8787）。');
});
