/**
 * editor/src/graph/edges/lane-color：六条泳道的着色（TypedEdge 用）。
 */
import type { Lane } from '@blueprint/core';

const COLORS: Record<Lane, string> = {
  control: '#888888',
  message: '#3b82f6',
  task: '#f59e0b',
  context: '#10b981',
  resource: '#a855f7',
  human: '#ef4444',
};

/**
 * 取某 lane 的描边色。
 *
 * @param lane 泳道
 * @returns 颜色
 */
export function laneColor(lane: Lane): string {
  return COLORS[lane];
}
