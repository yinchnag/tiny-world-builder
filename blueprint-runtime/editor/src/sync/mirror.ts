/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/mirror（本地变更 → 后端 · L-Sync）
 * 职责：把本地图变更（节点/边，携端口+lane+payloadType）镜像到后端。
 * ─────────────────────────────────────────────────────────────
 */
import type { RuntimeAdapter, GraphChange } from './runtime-adapter';
import type { Edge } from '@blueprint/core';

/**
 * 把本地新增的一条边镜像到后端。
 *
 * @param adapter 后端适配器
 * @param edge core 边（含端口/lane/payloadType）
 * @returns void
 */
export async function mirrorEdge(adapter: RuntimeAdapter, edge: Edge): Promise<void> {
  const change: GraphChange = { kind: 'edge', op: 'add', payload: edge };
  await adapter.mirror(change);
}
