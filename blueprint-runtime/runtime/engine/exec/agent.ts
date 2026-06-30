/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/exec/agent（Agent 执行器 · L4 · EX-3）
 * 职责：物化 message/task/context 输入 → 构对话 → 调 ModelProvider(进程内) → 产 AgentReport
 *       + 状态 working→reporting。provider 由 resolve 注入(properties.provider/model)，
 *       便于 mock 测试；密钥不进图(resolve 从 env 取，D6)。
 * ─────────────────────────────────────────────────────────────
 */
import type { NodeExecutor, ExecResult } from './executor';
import type { ChatMessage, ProviderResolver } from './providers/provider';
import { defaultModelFor } from './providers/registry';

// 各 in 口载荷 → user 消息文本（无内容则 undefined，被过滤）。
function asContext(x: unknown): string | undefined {
  const items = (x as { items?: string[] } | null)?.items;
  return items !== undefined && items.length > 0 ? `Context:\n${items.join('\n')}` : undefined;
}
function asMessage(x: unknown): string | undefined {
  const t = (x as { text?: string } | null)?.text;
  return t !== undefined && t !== '' ? t : undefined;
}
function asTask(x: unknown): string | undefined {
  const t = (x as { title?: string } | null)?.title;
  return t !== undefined && t !== '' ? `Task: ${t}` : undefined;
}
function userMsgs(list: unknown[] | undefined, conv: (x: unknown) => string | undefined): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const x of list ?? []) {
    const c = conv(x);
    if (c !== undefined) out.push({ role: 'user', content: c });
  }
  return out;
}

// 从物化输入构造对话消息（system + context/message/task）。
function buildMessages(systemPrompt: string, inputs: Readonly<Record<string, unknown[]>>): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...userMsgs(inputs.context_in, asContext),
    ...userMsgs(inputs.message_in, asMessage),
    ...userMsgs(inputs.task_in, asTask),
  ];
}

/**
 * 创建 Agent 执行器（进程内调模型；resolve 注入便于 mock）。
 *
 * @param resolve 供应商解析器 (name, model) → ModelProvider
 * @returns NodeExecutor
 */
export function createAgentExecutor(resolve: ProviderResolver): NodeExecutor {
  return async (input): Promise<ExecResult> => {
    const props = input.node.properties;
    const providerName = typeof props.provider === 'string' ? props.provider : 'openai';
    const model = typeof props.model === 'string' ? props.model : (defaultModelFor(providerName) ?? '');
    const systemPrompt = typeof props.systemPrompt === 'string' ? props.systemPrompt : 'You are a helpful agent.';

    const provider = resolve(providerName, model);
    if (provider === undefined) {
      return {
        outputs: [],
        nextState: 'blocked',
        events: [{ ts: input.clock.nowIso(), eventType: 'exec.failed', nodeId: input.node.id, payload: { message: `未知供应商 ${providerName}` } }],
      };
    }
    const { text } = await provider.complete({ model, messages: buildMessages(systemPrompt, input.inputs) });
    return { outputs: [{ port: 'report_out', payload: { summary: text } }], nextState: 'reporting' };
  };
}
