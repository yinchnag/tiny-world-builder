/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/graph/port（端口数据结构 · 00 §5.2）
 * 职责：Port 的不可变数据结构与构造器（dir/lane/payloadType/required/multiple）。
 *
 * 在分层中的位置：
 *   contracts / edge / validate ──► 本模块（端口形状之源）
 *   本模块 ──► types/payload-types（取 Lane）
 * ─────────────────────────────────────────────────────────────
 */
import type { Lane } from '../types/payload-types';

/** 端口方向。 */
export type PortDir = 'in' | 'out';

/** 类型化端口（节点的输入/输出接点）。 */
export interface Port {
  readonly id: string;
  readonly dir: PortDir;
  readonly payloadType: string;
  /** 必须与 payloadType 的 lane 一致（契约 C3 保证）。 */
  readonly lane: Lane;
  /** in 口：是否必须连接。 */
  readonly required: boolean;
  /** 是否允许多条边（扇入/扇出）。 */
  readonly multiple: boolean;
}

/** 构造端口入参（required/multiple 可省，默认 false）。 */
export interface PortInit {
  id: string;
  dir: PortDir;
  payloadType: string;
  lane: Lane;
  required?: boolean;
  multiple?: boolean;
}

/**
 * 构造一个端口（不可变）。
 *
 * @param init 端口字段；required/multiple 默认 false
 * @returns Port
 */
export function createPort(init: PortInit): Port {
  return {
    id: init.id,
    dir: init.dir,
    payloadType: init.payloadType,
    lane: init.lane,
    required: init.required ?? false,
    multiple: init.multiple ?? false,
  };
}
