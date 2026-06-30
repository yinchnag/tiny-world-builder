/**
 * 组件：editor/src/graph/edges/TypedEdge（自定义边 · L-Graph）
 * 职责：按 lane 着色 + 显示 payloadType 标签（着色逻辑在 lane-color，已测）。
 */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { laneColor } from './lane-color';
import type { FlowEdgeData } from '../../lib/flow-types';

export function TypedEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const data = props.data as FlowEdgeData | undefined;
  const color = data !== undefined ? laneColor(data.lane) : '#888888';
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color }} />
      {data !== undefined && (
        <EdgeLabelRenderer>
          <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color, fontSize: 10 }}>
            {data.payloadType}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
