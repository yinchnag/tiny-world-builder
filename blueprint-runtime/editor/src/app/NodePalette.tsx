/**
 * 组件：editor/src/app/NodePalette（节点面板 · L-App · BP-1 用户入口）
 * 职责：列出已注册的内置契约，点一下在画布新建该类型节点（可见/易见/可操作）。
 *       面板由 BUILTIN_CONTRACTS 驱动——新增家族契约后自动出现，无需改本文件。
 */
import { useRef } from 'react';
import { BUILTIN_CONTRACTS } from '@blueprint/core';
import { useGraphStore } from '../state/graph-store';
import type { FlowNode } from '../lib/flow-types';

export function NodePalette() {
  const addNode = useGraphStore((s) => s.addNode);
  const seq = useRef(0);
  return (
    <div
      data-testid="node-palette"
      style={{ width: 160, borderRight: '1px solid #ddd', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <strong style={{ fontSize: 12 }}>节点</strong>
      {BUILTIN_CONTRACTS.map((c) => (
        <button
          key={c.type}
          data-testid={`palette-add-${c.type}`}
          onClick={() => {
            seq.current += 1;
            const node: FlowNode = {
              id: `${c.type}-${seq.current}`,
              type: c.type,
              position: { x: 80 + seq.current * 24, y: 80 + seq.current * 24 },
              data: { state: c.state.initial, properties: {} },
            };
            addNode(node);
          }}
        >
          + {c.type}
        </button>
      ))}
    </div>
  );
}
