/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/nodes/registry（节点组件注册表 · L-NodeUI · 主扩展点）
 * 职责：type → 节点组件；喂给 xyflow nodeTypes。新增节点类型 = 加一个注册项。
 * ─────────────────────────────────────────────────────────────
 */
import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';

/** 一种节点类型的 UI 入口。 */
export interface NodeUiEntry {
  node: ComponentType<NodeProps>;
}

const registry = new Map<string, NodeUiEntry>();

/**
 * 注册某类型的节点组件。
 *
 * @param type 节点类型
 * @param entry UI 入口
 * @returns void
 */
export function registerNodeUi(type: string, entry: NodeUiEntry): void {
  registry.set(type, entry);
}

/**
 * 查询某类型的节点 UI 入口。
 *
 * @param type 节点类型
 * @returns 入口或 undefined
 */
export function lookupNodeUi(type: string): NodeUiEntry | undefined {
  return registry.get(type);
}

/**
 * 生成喂给 xyflow 的 nodeTypes 映射。
 *
 * @returns type → 组件
 */
export function nodeTypes(): Record<string, ComponentType<NodeProps>> {
  const out: Record<string, ComponentType<NodeProps>> = {};
  for (const [t, e] of registry) out[t] = e.node;
  return out;
}
