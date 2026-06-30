/**
 * core/types/compatibility 单测：覆盖黄金夹具 E1/E2 正例 + X1/X3 反例码。
 */
import { describe, it, expect } from 'vitest';
import { checkCompatible } from './compatibility';

describe('checkCompatible', () => {
  it('E1: AgentReport → AgentMessage is assignable (message lane)', () => {
    expect(checkCompatible('AgentReport', 'AgentMessage')).toEqual({ ok: true });
  });

  it('E2: DocumentSelection → ContextBundle is assignable (context lane)', () => {
    expect(checkCompatible('DocumentSelection', 'ContextBundle')).toEqual({ ok: true });
  });

  it('same type is always assignable', () => {
    expect(checkCompatible('AgentMessage', 'AgentMessage')).toEqual({ ok: true });
  });

  it('DocumentText → ContextBundle is assignable (BP-1 Document feeds Agent)', () => {
    expect(checkCompatible('DocumentText', 'ContextBundle')).toEqual({ ok: true });
  });

  it('MemoryFact → ContextBundle is assignable (BP-1 Memory feeds Agent)', () => {
    expect(checkCompatible('MemoryFact', 'ContextBundle')).toEqual({ ok: true });
  });

  it('X1: same lane but not assignable → payload.incompatible', () => {
    expect(checkCompatible('HumanReply', 'HumanAttention')).toEqual({
      ok: false,
      reason: 'payload.incompatible',
    });
  });

  it('X3: different lane → lane.mismatch', () => {
    expect(checkCompatible('DocumentSelection', 'AgentMessage')).toEqual({
      ok: false,
      reason: 'lane.mismatch',
    });
  });
});
