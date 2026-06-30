/**
 * use-workspace 单测：保存/加载往返。
 */
import { describe, it, expect } from 'vitest';
import { saveWorkspace, loadWorkspace, type WorkspacePort, type WorkspaceSnapshot } from './use-workspace';

function memPort(): WorkspacePort {
  let data: string | null = null;
  return {
    read: () => data,
    write: (d: string) => {
      data = d;
    },
  };
}

describe('use-workspace', () => {
  it('round-trips a snapshot through save/load', () => {
    const port = memPort();
    const snap: WorkspaceSnapshot = {
      nodes: [{ id: 'A', type: 'agent', position: { x: 1, y: 2 }, data: { state: 'idle', properties: {} } }],
      edges: [],
    };
    saveWorkspace(port, snap);
    expect(loadWorkspace(port)).toEqual(snap);
  });

  it('returns null when empty', () => {
    expect(loadWorkspace(memPort())).toBeNull();
  });
});
