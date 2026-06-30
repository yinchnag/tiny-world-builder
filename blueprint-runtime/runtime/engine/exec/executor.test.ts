/**
 * executor 单测：注册表 register/lookup。
 */
import { describe, it, expect } from 'vitest';
import { createExecutorRegistry, type NodeExecutor } from './executor';

describe('executor registry', () => {
  it('registers and looks up executors by type', () => {
    const reg = createExecutorRegistry();
    const echo: NodeExecutor = async () => ({ outputs: [] });
    reg.register('agent', echo);
    expect(reg.lookup('agent')).toBe(echo);
    expect(reg.lookup('nope')).toBeUndefined();
  });
});
