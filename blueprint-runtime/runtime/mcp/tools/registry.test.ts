/**
 * runtime/mcp/tools/registry 单测：注册/查询/列举。
 */
import { describe, it, expect } from 'vitest';
import { createToolRegistry } from './registry';

describe('tool registry', () => {
  it('registers, looks up, and lists tools', () => {
    const reg = createToolRegistry();
    reg.register({ name: 'agent_report', mutates: true, adminOnly: false, handler: () => ({ ok: true, value: null }) });
    expect(reg.lookup('agent_report')?.mutates).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.lookup('nope')).toBeUndefined();
  });
});
