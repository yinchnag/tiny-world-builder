/**
 * AGENT_CONTRACT 单测：C1–C7 元校验 + 注册 + 关键连接相容性（BP-1）。
 */
import { describe, it, expect } from 'vitest';
import { AGENT_CONTRACT } from './agent';
import { validateContract, register, lookup } from '../registry';
import { canConnect } from '../../validate';
import type { Port } from '../../graph/port';

function port(ports: readonly Port[], id: string): Port | undefined {
  return ports.find((p) => p.id === id);
}

describe('AGENT_CONTRACT', () => {
  it('passes C1–C7 meta-validation', () => {
    expect(validateContract(AGENT_CONTRACT)).toEqual([]);
  });

  it('registers without throwing and is retrievable as execution family', () => {
    register(AGENT_CONTRACT);
    expect(lookup('agent')?.family).toBe('execution');
    expect(lookup('agent')?.runtime).toBe('contex');
  });

  it('report_out is assignable into message_in (AgentReport → AgentMessage)', () => {
    const r = canConnect(port(AGENT_CONTRACT.outputs, 'report_out'), port(AGENT_CONTRACT.inputs, 'message_in'));
    expect(r.ok).toBe(true);
  });

  it('handoff_out rides the task lane via the new HandoffRequest type', () => {
    expect(port(AGENT_CONTRACT.outputs, 'handoff_out')?.payloadType).toBe('HandoffRequest');
    expect(port(AGENT_CONTRACT.outputs, 'handoff_out')?.lane).toBe('task');
  });
});
