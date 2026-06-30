/**
 * providers/registry 单测：解析供应商 + 默认 model；key 从 env 取。
 */
import { describe, it, expect } from 'vitest';
import { resolveProvider, defaultModelFor } from './registry';

describe('provider registry', () => {
  it('resolves a known provider with its env key; unknown → undefined', () => {
    expect(resolveProvider('deepseek', { DEEPSEEK_API_KEY: 'k' })).toBeDefined();
    expect(resolveProvider('qwen', {})).toBeDefined(); // 无 key 也给 provider（调用时才报错）
    expect(resolveProvider('nope', {})).toBeUndefined();
  });

  it('exposes default models', () => {
    expect(defaultModelFor('deepseek')).toBe('deepseek-chat');
    expect(defaultModelFor('nope')).toBeUndefined();
  });
});
