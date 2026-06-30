/**
 * 模块：runtime/engine/exec/providers/registry（供应商注册表/解析 · EX-2）
 * 职责：内置 OpenAI 兼容供应商配置(名→{baseURL, apiKeyEnv, defaultModel})；
 *       resolveProvider 从 env 取 key（D6：密钥只在服务端，绝不进图）→ ModelProvider。
 */
import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { ModelProvider } from './provider';

/** 供应商配置。 */
export interface ProviderConfig {
  readonly baseURL: string;
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
}

/** 内置 OpenAI 兼容供应商（DeepSeek/Qwen 共用同一适配器，仅 baseURL/key 不同）。 */
export const PROVIDERS: Readonly<Record<string, ProviderConfig>> = {
  openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', defaultModel: 'qwen-plus' },
};

/**
 * 某供应商的默认 model。
 *
 * @param name 供应商名
 * @returns 默认 model 或 undefined
 */
export function defaultModelFor(name: string): string | undefined {
  return PROVIDERS[name]?.defaultModel;
}

/**
 * 解析供应商名 → ModelProvider（key 从 env 取）。
 *
 * @param name 供应商名
 * @param env 环境变量表（密钥来源）
 * @param fetchFn fetch 实现（默认全局）
 * @returns ModelProvider 或 undefined（未知供应商）
 */
export function resolveProvider(
  name: string,
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): ModelProvider | undefined {
  const cfg = PROVIDERS[name];
  if (cfg === undefined) return undefined;
  return createOpenAiCompatibleProvider({ baseURL: cfg.baseURL, apiKey: env[cfg.apiKeyEnv] ?? '' }, fetchFn);
}
