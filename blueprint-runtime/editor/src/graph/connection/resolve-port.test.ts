/**
 * resolve-port 单测：由节点类型契约定位端口。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltinContracts } from '@blueprint/core';
import { makeResolver } from './resolve-port';
import type { FlowNode } from '../../lib/flow-types';

const NODES: FlowNode[] = [{ id: 'A', type: 'agent', position: { x: 0, y: 0 }, data: { state: 'idle', properties: {} } }];

describe('makeResolver', () => {
  beforeAll(() => registerBuiltinContracts());

  it('resolves a port from the node contract; undefined for unknown', () => {
    const resolve = makeResolver(NODES);
    expect(resolve('A', 'report_out')?.payloadType).toBe('AgentReport');
    expect(resolve('A', 'nope')).toBeUndefined();
    expect(resolve('X', 'report_out')).toBeUndefined();
  });
});
