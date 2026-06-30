/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/graph/edge（边数据结构 · 00 §5.4）
 * 职责：Edge 的不可变数据结构与构造器（端口级 source/target + lane + payloadType）。
 *
 * 在分层中的位置：
 *   graph / validate / message-bus ──► 本模块（边形状之源）
 * ─────────────────────────────────────────────────────────────
 */
import type { Lane } from '../types/payload-types';

/** 端口引用：定位某节点上的某端口。 */
export interface PortRef {
  readonly node: string;
  readonly port: string;
}

/** 一条有向边：从 source 端口流向 target 端口，携带 lane 与 payloadType。 */
export interface Edge {
  readonly id: string;
  readonly source: PortRef;
  readonly target: PortRef;
  readonly lane: Lane;
  readonly payloadType: string;
  readonly directed: boolean;
  /** 兼容旧语义标签，仅作显示。 */
  readonly semanticKind?: string;
}

/** 构造边入参（directed 默认 true）。 */
export interface EdgeInit {
  id: string;
  source: PortRef;
  target: PortRef;
  lane: Lane;
  payloadType: string;
  directed?: boolean;
  semanticKind?: string;
}

/**
 * 构造一条边（不可变；directed 默认 true）。
 *
 * @param init 边字段
 * @returns Edge
 */
export function createEdge(init: EdgeInit): Edge {
  return {
    id: init.id,
    source: init.source,
    target: init.target,
    lane: init.lane,
    payloadType: init.payloadType,
    directed: init.directed ?? true,
    semanticKind: init.semanticKind,
  };
}
