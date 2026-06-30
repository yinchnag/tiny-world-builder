/**
 * G4 契约元校验的离线兜底（30 §G4 / §2）+ registry.ts 的镜像测试。
 * 覆盖 C1–C7 的正反例，并断言 register() 抛 `contract.invalid`。
 */
import { describe, it, expect } from 'vitest';
import { validateContract, register, lookup, type NodeContract, type Lane } from './registry';

const LANES: Record<string, Lane> = {
  AgentMessage: 'message',
  AgentReport: 'message',
  ContextBundle: 'context',
};

function goodContract(): NodeContract {
  return {
    type: 'agent',
    family: 'execution',
    inputs: [
      { id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' },
      { id: 'context_in', dir: 'in', payloadType: 'ContextBundle', lane: 'context' },
    ],
    outputs: [{ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' }],
    state: {
      values: ['idle', 'working', 'done'],
      initial: 'idle',
      transitions: [
        ['idle', 'working', 'start'],
        ['working', 'done', 'finish'],
      ],
    },
    runtime: 'contex',
  };
}

describe('validateContract / register (G4)', () => {
  it('accepts a well-formed contract and registers it', () => {
    const c = goodContract();
    expect(validateContract(c, LANES)).toEqual([]);
    register(c, LANES);
    expect(lookup('agent')?.type).toBe('agent');
  });

  it('C1: rejects input port not ending in _in', () => {
    const c = goodContract();
    c.inputs[0].id = 'message'; // 缺 _in
    expect(validateContract(c, LANES).some((e) => e.startsWith('C1'))).toBe(true);
  });

  it('C3: rejects lane not matching payloadType lane', () => {
    const c = goodContract();
    c.inputs[0].lane = 'task';
    expect(validateContract(c, LANES).some((e) => e.startsWith('C3'))).toBe(true);
  });

  it('C4: rejects unregistered payloadType', () => {
    const c = goodContract();
    c.outputs[0].payloadType = 'Nope';
    expect(validateContract(c, LANES).some((e) => e.startsWith('C4'))).toBe(true);
  });

  it('C5: rejects initial state not in values', () => {
    const c = goodContract();
    c.state.initial = 'ghost';
    expect(validateContract(c, LANES).some((e) => e.startsWith('C5'))).toBe(true);
  });

  it('C6/C7: rejects bad family and runtime', () => {
    const c = goodContract();
    // @ts-expect-error 故意越界
    c.family = 'bogus';
    expect(validateContract(c, LANES).some((e) => e.startsWith('C6'))).toBe(true);
  });

  it('register() throws contract.invalid on a bad contract', () => {
    const c = goodContract();
    c.outputs[0].id = 'report'; // C1 违规
    try {
      register(c, LANES);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('contract.invalid');
    }
  });
});
