/**
 * openai-compatible 单测：产正确 chat/completions 请求 + 解析 content（mock fetch）。
 */
import { describe, it, expect } from 'vitest';
import { createOpenAiCompatibleProvider } from './openai-compatible';

describe('createOpenAiCompatibleProvider', () => {
  it('posts chat/completions with model+messages and parses the reply', async () => {
    let captured: { url: string; body: { model: string; messages: unknown }; auth?: string } | undefined;
    const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
      captured = {
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: (init?.headers as Record<string, string> | undefined)?.authorization,
      };
      return { json: async () => ({ choices: [{ message: { content: '你好' } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const provider = createOpenAiCompatibleProvider({ baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-x' }, fetchFn);
    const r = await provider.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });

    expect(r.text).toBe('你好');
    expect(captured?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(captured?.body.model).toBe('deepseek-chat');
    expect(captured?.auth).toBe('Bearer sk-x');
  });
});
