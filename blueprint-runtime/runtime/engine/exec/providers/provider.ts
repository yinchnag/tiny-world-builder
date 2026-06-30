/**
 * 模块：runtime/engine/exec/providers/provider（模型供应商统一面 · EX-2）
 * 职责：定义 ModelProvider 接口（适配器实现）+ 消息/入参/结果类型。纯类型，无逻辑。
 */

/** 聊天消息（OpenAI 风格 role/content）。 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** 补全入参。 */
export interface CompleteOpts {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
}

/** 补全结果。 */
export interface CompleteResult {
  readonly text: string;
}

/** 模型供应商（统一面，各厂商适配器实现）。 */
export interface ModelProvider {
  complete(opts: CompleteOpts): Promise<CompleteResult>;
}

/** 供应商解析器：(供应商名, model) → ModelProvider（无则 undefined）。 */
export type ProviderResolver = (name: string, model: string) => ModelProvider | undefined;
