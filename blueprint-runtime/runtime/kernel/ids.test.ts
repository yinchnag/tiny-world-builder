/**
 * runtime/kernel/ids 单测：前缀 + 唯一性。
 */
import { describe, it, expect } from 'vitest';
import { nodeId, edgeId, eventId } from './ids';

describe('ids', () => {
  it('carry type prefixes', () => {
    expect(nodeId()).toMatch(/^node_/);
    expect(edgeId()).toMatch(/^edge_/);
    expect(eventId()).toMatch(/^evt_/);
  });

  it('are unique across calls', () => {
    const ids = new Set([nodeId(), nodeId(), nodeId()]);
    expect(ids.size).toBe(3);
  });
});
