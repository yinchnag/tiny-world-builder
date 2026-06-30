/**
 * agent 执行器单测：从输入构对话 → 调（mock）provider → 产 AgentReport。
 */
import { describe, it, expect } from 'vitest';
import { createAgentExecutor } from './agent';
import { fixedClock } from '../../kernel/clock';
import type { ExecInput } from './executor';
import type { ChatMessage, ModelProvider, ProviderResolver } from './providers/provider';

const clock = fixedClock('2026-06-30T00:00:00.000Z');

describe('createAgentExecutor', () => {
  it('builds messages from inputs, calls the provider, outputs an AgentReport', async () => {
    let seen: readonly ChatMessage[] = [];
    const provider: ModelProvider = {
      complete: async (opts) => {
        seen = opts.messages;
        return { text: '回答' };
      },
    };
    const resolve: ProviderResolver = () => provider;
    const exec = createAgentExecutor(resolve);

    const input: ExecInput = {
      node: { id: 'A', type: 'agent', state: 'working', properties: { provider: 'deepseek', model: 'deepseek-chat', systemPrompt: 'You are X' } },
      inputs: { context_in: [{ items: ['fact1'] }], message_in: [{ text: 'hi' }] },
      clock,
    };
    const r = await exec(input);

    expect(r.nextState).toBe('reporting');
    expect((r.outputs.find((o) => o.port === 'report_out')?.payload as { summary: string }).summary).toBe('回答');
    expect(seen[0]).toEqual({ role: 'system', content: 'You are X' });
    expect(seen.some((m) => m.content.includes('fact1'))).toBe(true);
    expect(seen.some((m) => m.content === 'hi')).toBe(true);
  });

  it('emits exec.failed for an unknown provider', async () => {
    const exec = createAgentExecutor(() => undefined);
    const r = await exec({ node: { id: 'A', type: 'agent', state: 'working', properties: { provider: 'nope' } }, inputs: {}, clock });
    expect(r.outputs).toHaveLength(0);
    expect(r.events?.[0]?.eventType).toBe('exec.failed');
  });
});
