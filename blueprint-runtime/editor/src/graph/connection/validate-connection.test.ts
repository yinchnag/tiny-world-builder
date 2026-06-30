/**
 * validate-connection 单测：编辑期 canConnect（正例 + 拒绝码），与运行期同一函数。
 */
import { describe, it, expect } from 'vitest';
import { checkConnection, type PortResolver } from './validate-connection';
import { createPort } from '@blueprint/core';

const PORTS: Record<string, ReturnType<typeof createPort>> = {
  'A:report_out': createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' }),
  'B:message_in': createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' }),
  'D:selection_out': createPort({ id: 'selection_out', dir: 'out', payloadType: 'DocumentSelection', lane: 'context' }),
};
const resolve: PortResolver = (n, p) => PORTS[`${n}:${p}`];

describe('checkConnection', () => {
  it('accepts a compatible connection (E1)', () => {
    expect(checkConnection({ source: 'A', sourceHandle: 'report_out', target: 'B', targetHandle: 'message_in' }, resolve)).toEqual({ ok: true });
  });

  it('rejects lane mismatch with a reason (X3)', () => {
    expect(checkConnection({ source: 'D', sourceHandle: 'selection_out', target: 'B', targetHandle: 'message_in' }, resolve).reason).toBe('lane.mismatch');
  });

  it('reports port.not_found for an unknown handle', () => {
    expect(checkConnection({ source: 'A', sourceHandle: 'nope', target: 'B', targetHandle: 'message_in' }, resolve).reason).toBe('port.not_found');
  });
});
