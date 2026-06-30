/**
 * ─────────────────────────────────────────────────────────────
 * EX-3 集成：运行一个「通过工作流搭建的 Agent」（mock provider，确定性）。
 *
 * 全链路：create_node/create_edge 搭图 → deliver 喂 context → run_node 触发 Agent 执行器
 *   → 物化输入 → 调（mock）模型 → 产 AgentReport → 沿出边 route → message.delivered。
 * mock provider 顶替真 LLM；换成 resolveProvider(env) 即真推理（OpenAI/DeepSeek/Qwen）。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate } from '../runtime/persist/sqlite-adapter';
import { createSseHub } from '../runtime/mcp/sse';
import { createToolRegistry, type ToolDef } from '../runtime/mcp/tools/registry';
import { registerGraphTools } from '../runtime/mcp/tools/graph-tools';
import { createExecutorRegistry } from '../runtime/engine/exec/executor';
import { createAgentExecutor } from '../runtime/engine/exec/agent';
import { fixedClock } from '../runtime/kernel/clock';
import { registerBuiltinContracts, type RuntimeEvent } from '../core/index';

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(() => registerBuiltinContracts());

describe('EX-3 run a workflow-built Agent', () => {
  it('delivers context, runs the agent, and its AgentReport flows downstream', async () => {
    const db = openDb();
    migrate(db);
    const hub = createSseHub();
    const events: RuntimeEvent[] = [];
    hub.subscribe((e) => events.push(e));

    const executors = createExecutorRegistry();
    // mock provider 顶替真 LLM
    executors.register('agent', createAgentExecutor(() => ({ complete: async () => ({ text: 'AGENT-REPLY' }) })));

    const reg = createToolRegistry();
    registerGraphTools(reg, { db, hub, clock: fixedClock('2026-06-30T00:00:00.000Z'), executors });
    const call = (name: string, args: Record<string, unknown>): ReturnType<ToolDef['handler']> => {
      const def = reg.lookup(name);
      if (def === undefined) throw new Error(`no tool ${name}`);
      return def.handler({ name, arguments: args }, {});
    };

    call('create_node', { id: 'D', type: 'document' });
    call('create_node', { id: 'A', type: 'agent', properties: { provider: 'deepseek' } });
    call('create_node', { id: 'B', type: 'agent' });
    call('create_edge', { id: 'E_ctx', source: { node: 'D', port: 'selection_out' }, target: { node: 'A', port: 'context_in' }, lane: 'context', payloadType: 'DocumentSelection' });
    call('create_edge', { id: 'E_out', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });

    call('deliver', { edgeId: 'E_ctx', payload: { text: 'important fact' } });
    call('run_node', { nodeId: 'A' });

    await waitFor(() => events.some((e) => e.eventType === 'message.delivered' && e.nodeId === 'B'), 2000);
    const report = events.find((e) => e.eventType === 'message.delivered' && e.nodeId === 'B');
    expect((report?.payload as { summary: string }).summary).toBe('AGENT-REPLY');
    expect(events.some((e) => e.eventType === 'exec.completed' && e.nodeId === 'A')).toBe(true);
  });
});
