/**
 * 模块：editor/src/graph/connection/resolve-port（端口解析器 · L-Graph）
 * 职责：由 store 节点 + 契约定位 Port——nodeId→节点类型→契约→按 portId 找端口。
 *       喂给 checkConnection（编辑期校验）与 planConnection（建边）。
 */
import { lookup, type Port } from '@blueprint/core';
import type { FlowNode } from '../../lib/flow-types';
import type { PortResolver } from './validate-connection';

/**
 * 构造端口解析器（绑定当前图节点）。
 *
 * @param nodes 当前图节点
 * @returns PortResolver
 */
export function makeResolver(nodes: readonly FlowNode[]): PortResolver {
  return (nodeId: string, portId: string): Port | undefined => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node === undefined) return undefined;
    const contract = lookup(node.type ?? '');
    if (contract === undefined) return undefined;
    return [...contract.inputs, ...contract.outputs].find((p) => p.id === portId);
  };
}
