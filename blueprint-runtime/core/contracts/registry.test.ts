/**
 * G4 契约元校验离线兜底（30 §G4）+ registry 镜像。
 * 端口用 canonical createPort；lane 默认取已注册载荷类型（payloadLaneMap）。
 */
import { describe, it, expect } from 'vitest';
import { validateContract, register, lookup, type NodeContract, type Family } from './registry';
import { createPort } from '../graph/port';

function goodContract(): NodeContract {
  return {
    type: 'agent',
    family: 'execution',
    inputs: [
      createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' }),
      createPort({ id: 'context_in', dir: 'in', payloadType: 'ContextBundle', lane: 'context' }),
    ],
    outputs: [createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' })],
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
    expect(validateContract(c)).toEqual([]);
    register(c);
    expect(lookup('agent')?.type).toBe('agent');
  });

  it('C1: rejects an input port not ending in _in', () => {
    const c: NodeContract = {
      ...goodContract(),
      inputs: [createPort({ id: 'message', dir: 'in', payloadType: 'AgentMessage', lane: 'message' })],
    };
    expect(validateContract(c).some((e) => e.startsWith('C1'))).toBe(true);
  });

  it('C3: rejects lane not matching its payloadType lane', () => {
    const c: NodeContract = {
      ...goodContract(),
      inputs: [createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'task' })],
    };
    expect(validateContract(c).some((e) => e.startsWith('C3'))).toBe(true);
  });

  it('C4: rejects an unregistered payloadType', () => {
    const c: NodeContract = {
      ...goodContract(),
      outputs: [createPort({ id: 'x_out', dir: 'out', payloadType: 'Nope', lane: 'message' })],
    };
    expect(validateContract(c).some((e) => e.startsWith('C4'))).toBe(true);
  });

  it('C5: rejects initial state not in values', () => {
    const c: NodeContract = { ...goodContract(), state: { ...goodContract().state, initial: 'ghost' } };
    expect(validateContract(c).some((e) => e.startsWith('C5'))).toBe(true);
  });

  it('C6: rejects a bad family', () => {
    const c: NodeContract = { ...goodContract(), family: 'bogus' as Family };
    expect(validateContract(c).some((e) => e.startsWith('C6'))).toBe(true);
  });

  it('register() throws contract.invalid on a bad contract', () => {
    const c: NodeContract = {
      ...goodContract(),
      outputs: [createPort({ id: 'report', dir: 'out', payloadType: 'AgentReport', lane: 'message' })], // C1
    };
    try {
      register(c);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('contract.invalid');
    }
  });
});
