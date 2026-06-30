/**
 * 模块：runtime/engine/exec/providers/openai-compatible（OpenAI 兼容适配器 · EX-2）
 * 职责：裸 fetch 调 `{baseURL}/chat/completions`——一把覆盖 OpenAI / DeepSeek / Qwen 等
 *       OpenAI 兼容端点（仅 baseURL/key/model 不同）。无 SDK 依赖。
 */
import type { ModelProvider } from './provider';

/**
 * 创建 OpenAI 兼容供应商。
 *
 * @param cfg 配置
 * @param cfg.baseURL 端点基址
 * @param cfg.apiKey 密钥
 * @param fetchFn fetch 实现（默认全局；测试注入）
 * @returns ModelProvider
 */
export function createOpenAiCompatibleProvider(
  cfg: { readonly baseURL: string; readonly apiKey: string },
  fetchFn: typeof fetch = fetch,
): ModelProvider {
  return {
    async complete(opts) {
      const resp = await fetchFn(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: opts.model, messages: opts.messages, temperature: opts.temperature }),
      });
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return { text: json.choices?.[0]?.message?.content ?? '' };
    },
  };
}
