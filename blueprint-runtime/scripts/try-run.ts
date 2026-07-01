/**
 * ─────────────────────────────────────────────────────────────
 * 调试试跑：模拟浏览器的完整 HTTP + SSE 路径，把事件全打印出来。
 * 起 server → 订阅 SSE → create_node/edge → deliver context → run_node，
 * 打印收到的每条事件。用来判断"点运行没结果"是后端还是浏览器问题。
 *
 * $env:DEEPSEEK_API_KEY="sk-xxx"; pnpm try:run deepseek
 * 若看到 `message.delivered B message_in {"summary":...}` → 后端全通，问题在浏览器(多半刷新即好)。
 * 若看到 `exec.failed ...` → provider/key/model 问题(看 payload.message)。
 * ─────────────────────────────────────────────────────────────
 */
import type { AddressInfo } from 'node:net';
import { createRuntimeServer } from '../runtime/mcp/server';

async function main(): Promise<void> {
  const provider = process.argv[2] ?? 'deepseek';
  const { server } = createRuntimeServer(process.env);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(name: string, args: Record<string, unknown>): Promise<void> {
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
  }

  const sse = await fetch(`${base}/mcp/sse`);
  if (sse.body === null) throw new Error('SSE 无 body');
  const reader = sse.body.getReader();
  const dec = new TextDecoder();
  void (async () => {
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buf = buf.slice(i + 2);
        if (line !== undefined) {
          const ev = JSON.parse(line.slice(5).trim()) as { eventType: string; nodeId?: string; portId?: string; payload?: unknown };
          console.log(`SSE ◀ ${ev.eventType} ${ev.nodeId ?? ''} ${ev.portId ?? ''} ${ev.payload !== undefined ? JSON.stringify(ev.payload) : ''}`);
        }
        i = buf.indexOf('\n\n');
      }
    }
  })();

  await new Promise((r) => setTimeout(r, 100));
  await call('create_node', { id: 'D', type: 'document' });
  await call('create_node', { id: 'A', type: 'agent', properties: { provider, systemPrompt: '你是简洁中文助手。' } });
  await call('create_node', { id: 'B', type: 'agent' });
  await call('create_edge', { id: 'Ectx', source: { node: 'D', port: 'selection_out' }, target: { node: 'A', port: 'context_in' }, lane: 'context', payloadType: 'DocumentSelection' });
  await call('create_edge', { id: 'Eout', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
  await call('deliver', { edgeId: 'Ectx', payload: { text: 'Blueprint 是一个蓝图式图编辑器 + 图运行时项目。' } });
  console.log(`▶ run_node A（provider=${provider}）… 等真模型返回`);
  await call('run_node', { nodeId: 'A' });

  await new Promise((r) => setTimeout(r, 15000));
  await reader.cancel();
  server.close();
  console.log('（完。看到 message.delivered B message_in {"summary":...} = 后端全通）');
}

main().catch((err: unknown) => {
  console.error('调试失败：', err);
  process.exit(1);
});
