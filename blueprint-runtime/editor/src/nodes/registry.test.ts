/**
 * nodes/registry 单测：注册/查询/nodeTypes 映射。
 */
import { describe, it, expect } from 'vitest';
import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { registerNodeUi, lookupNodeUi, nodeTypes } from './registry';

const Dummy: ComponentType<NodeProps> = () => null;

describe('nodes registry', () => {
  it('registers, looks up, and produces a nodeTypes map', () => {
    registerNodeUi('agent', { node: Dummy });
    expect(lookupNodeUi('agent')?.node).toBe(Dummy);
    expect(Object.keys(nodeTypes())).toContain('agent');
    expect(lookupNodeUi('nope')).toBeUndefined();
  });
});
