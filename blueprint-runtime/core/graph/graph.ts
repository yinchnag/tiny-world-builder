/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/graph/graph（图容器 · 00 §5）
 * 职责：Graph 容器（nodes/edges）+ 不可变增删查；纯函数，零 I/O。
 *
 * 设计要点：
 *   - 全部修改返回新 Graph（不可变）。
 *   - removeNode 连带清理其关联边（incident edges）。
 *   - 拓扑遍历留到调度需要时（F2）再加，本文件先做 CRUD + 查询。
 * ─────────────────────────────────────────────────────────────
 */
import type { GraphNode } from './node';
import type { Edge } from './edge';

/** 图容器：节点与边的不可变集合。 */
export interface Graph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: ReadonlyMap<string, Edge>;
}

/**
 * 空图。
 *
 * @returns 不含节点/边的 Graph
 */
export function emptyGraph(): Graph {
  return { nodes: new Map(), edges: new Map() };
}

/**
 * 加入/替换一个节点（不可变）。
 *
 * @param g 原图
 * @param node 节点
 * @returns 新图
 */
export function addNode(g: Graph, node: GraphNode): Graph {
  const nodes = new Map(g.nodes);
  nodes.set(node.id, node);
  return { nodes, edges: g.edges };
}

/**
 * 加入/替换一条边（不可变）。
 *
 * @param g 原图
 * @param edge 边
 * @returns 新图
 */
export function addEdge(g: Graph, edge: Edge): Graph {
  const edges = new Map(g.edges);
  edges.set(edge.id, edge);
  return { nodes: g.nodes, edges };
}

/**
 * 删除一个节点及其关联边（不可变）。
 *
 * @param g 原图
 * @param id 节点 id
 * @returns 新图
 */
export function removeNode(g: Graph, id: string): Graph {
  const nodes = new Map(g.nodes);
  nodes.delete(id);
  const edges = new Map<string, Edge>();
  for (const [eid, e] of g.edges) {
    if (e.source.node !== id && e.target.node !== id) edges.set(eid, e);
  }
  return { nodes, edges };
}

/**
 * 删除一条边（不可变）。
 *
 * @param g 原图
 * @param id 边 id
 * @returns 新图
 */
export function removeEdge(g: Graph, id: string): Graph {
  const edges = new Map(g.edges);
  edges.delete(id);
  return { nodes: g.nodes, edges };
}

/**
 * 取节点。
 *
 * @param g 图
 * @param id 节点 id
 * @returns 节点或 undefined
 */
export function getNode(g: Graph, id: string): GraphNode | undefined {
  return g.nodes.get(id);
}

/**
 * 取边。
 *
 * @param g 图
 * @param id 边 id
 * @returns 边或 undefined
 */
export function getEdge(g: Graph, id: string): Edge | undefined {
  return g.edges.get(id);
}

/**
 * 列出全部节点。
 *
 * @param g 图
 * @returns 节点数组
 */
export function listNodes(g: Graph): GraphNode[] {
  return [...g.nodes.values()];
}

/**
 * 列出全部边。
 *
 * @param g 图
 * @returns 边数组
 */
export function listEdges(g: Graph): Edge[] {
  return [...g.edges.values()];
}

/**
 * 某节点的出边。
 *
 * @param g 图
 * @param nodeId 节点 id
 * @returns 出边数组
 */
export function edgesFrom(g: Graph, nodeId: string): Edge[] {
  return listEdges(g).filter((e) => e.source.node === nodeId);
}

/**
 * 某节点的入边。
 *
 * @param g 图
 * @param nodeId 节点 id
 * @returns 入边数组
 */
export function edgesTo(g: Graph, nodeId: string): Edge[] {
  return listEdges(g).filter((e) => e.target.node === nodeId);
}
