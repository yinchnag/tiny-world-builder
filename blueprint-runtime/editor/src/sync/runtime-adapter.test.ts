/**
 * runtime-adapter 单测：no-op 与 mock。
 */
import { describe, it, expect } from 'vitest';
import { createNoopAdapter, createMockAdapter } from './runtime-adapter';
import type { RuntimeEvent } from '@blueprint/core';

const EV: RuntimeEvent = { seq: 1, ts: 't', eventType: 'node.transitioned', nodeId: 'A', payload: { to: 'working' } };

describe('runtime-adapter', () => {
  it('no-op adapter resolves mirror and returns an unsubscribe', async () => {
    const a = createNoopAdapter();
    await a.mirror({ kind: 'edge', op: 'add', payload: {} });
    expect(typeof a.subscribe(() => {})).toBe('function');
  });

  it('mock adapter fans out emit and records mirror', async () => {
    const a = createMockAdapter();
    const seen: number[] = [];
    a.subscribe((e) => seen.push(e.seq));
    a.emit(EV);
    await a.mirror({ kind: 'node', op: 'update', payload: {} });
    expect(seen).toEqual([1]);
    expect(a.mirrored).toHaveLength(1);
  });
});
