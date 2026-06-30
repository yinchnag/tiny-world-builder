/**
 * 组件：editor/src/nodes/GenericNode（默认节点 · L-NodeUI）
 * 职责：渲染节点外壳 + 状态 + 由契约把端口竖排成「可抓取、带标签」的 typed Handle，
 *       每个端口是独立可连接目标（BP-2 拖拽连线的前提）。
 */
import { Fragment } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { lookup } from '@blueprint/core';
import type { FlowNodeData } from '../lib/flow-types';

const HEAD = 34;
const GAP = 20;

export function GenericNode({ type, data }: NodeProps) {
  const contract = lookup(type);
  const d = data as FlowNodeData;
  const inputs = contract?.inputs ?? [];
  const outputs = contract?.outputs ?? [];
  const rows = Math.max(inputs.length, outputs.length, 1);
  return (
    <div
      style={{
        position: 'relative',
        minWidth: 180,
        height: HEAD + rows * GAP,
        border: '1px solid #bbb',
        borderRadius: 6,
        background: '#fff',
        padding: 6,
      }}
    >
      <strong style={{ fontSize: 12 }}>{type}</strong>
      <div style={{ fontSize: 10, color: '#888' }}>{d.state}</div>
      {inputs.map((p, i) => (
        <Fragment key={p.id}>
          <Handle id={p.id} type="target" position={Position.Left} style={{ top: HEAD + i * GAP }} />
          <span style={{ position: 'absolute', left: 10, top: HEAD + i * GAP - 7, fontSize: 9, color: '#555' }}>{p.id}</span>
        </Fragment>
      ))}
      {outputs.map((p, i) => (
        <Fragment key={p.id}>
          <Handle id={p.id} type="source" position={Position.Right} style={{ top: HEAD + i * GAP }} />
          <span style={{ position: 'absolute', right: 10, top: HEAD + i * GAP - 7, fontSize: 9, color: '#555' }}>{p.id}</span>
        </Fragment>
      ))}
    </div>
  );
}
