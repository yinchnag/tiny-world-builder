/**
 * 组件：editor/src/nodes/GenericNode（默认节点 · L-NodeUI）
 * 职责：渲染节点外壳 + 状态 + 由契约摆 typed Handle 端口（缺省实现）。
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { lookup } from '@blueprint/core';
import type { FlowNodeData } from '../lib/flow-types';

export function GenericNode({ type, data }: NodeProps) {
  const contract = lookup(type);
  const d = data as FlowNodeData;
  return (
    <div style={{ padding: 8, border: '1px solid #ccc', borderRadius: 6, background: '#fff', minWidth: 80 }}>
      <strong>{type}</strong>
      <div style={{ fontSize: 10, color: '#666' }}>{d.state}</div>
      {contract?.inputs.map((p) => (
        <Handle key={p.id} id={p.id} type="target" position={Position.Left} />
      ))}
      {contract?.outputs.map((p) => (
        <Handle key={p.id} id={p.id} type="source" position={Position.Right} />
      ))}
    </div>
  );
}
