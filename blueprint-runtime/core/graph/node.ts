/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/graph/node（节点实例数据结构 · 00 §5.3）
 * 职责：GraphNode 实例（id/type/state/properties/view）+ 不可变更新。
 *
 * 设计要点（view/runtime 分离，00 §5.3）：
 *   - state/properties 是运行真相；view（位置/尺寸/外观）仅前端关心、可缺省。
 *   - 全部更新返回新对象（不可变），与事件溯源同构。
 * 命名：用 GraphNode 而非 Node，避免与 DOM 全局 Node 混淆。
 * ─────────────────────────────────────────────────────────────
 */

/** 节点视图（位置/尺寸/外观）——仅前端编辑器关心。 */
export interface NodeView {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  minimized: boolean;
  pinned: boolean;
}

/** 画布上某个具体节点实例。 */
export interface GraphNode {
  readonly id: string;
  /** 指向 NodeContract.type。 */
  readonly type: string;
  /** 取自契约 state.values。 */
  readonly state: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly view?: NodeView;
}

/** 构造节点入参（properties 默认空）。 */
export interface NodeInit {
  id: string;
  type: string;
  state: string;
  properties?: Record<string, unknown>;
  view?: NodeView;
}

/**
 * 构造一个节点实例（不可变）。
 *
 * @param init 节点字段；properties 默认 {}
 * @returns GraphNode
 */
export function createNode(init: NodeInit): GraphNode {
  return {
    id: init.id,
    type: init.type,
    state: init.state,
    properties: init.properties ?? {},
    view: init.view,
  };
}

/**
 * 返回状态变更后的新节点（不可变）。
 *
 * @param node 原节点
 * @param state 新状态值
 * @returns 新节点
 */
export function withState(node: GraphNode, state: string): GraphNode {
  return { ...node, state };
}

/**
 * 返回属性合并后的新节点（不可变；浅合并）。
 *
 * @param node 原节点
 * @param patch 要合并的属性
 * @returns 新节点
 */
export function withProperties(node: GraphNode, patch: Record<string, unknown>): GraphNode {
  return { ...node, properties: { ...node.properties, ...patch } };
}
