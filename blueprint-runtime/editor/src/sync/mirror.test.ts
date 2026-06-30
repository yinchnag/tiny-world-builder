/**
 * mirror 单测：本地新增边 → 镜像到（mock）后端。
 */
import { describe, it, expect } from 'vitest';
import { createMockAdapter } from './runtime-adapter';
import { mirrorEdge } from './mirror';
import { createEdge } from '@blueprint/core';

describe('mirror', () => {
  it('mirrors a new edge to the backend', async () => {
    const adapter = createMockAdapter();
    const edge = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
    await mirrorEdge(adapter, edge);
    expect(adapter.mirrored).toHaveLength(1);
    expect(adapter.mirrored[0]).toMatchObject({ kind: 'edge', op: 'add' });
  });
});
