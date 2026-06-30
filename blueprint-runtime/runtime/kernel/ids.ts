/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/kernel/ids（id 生成 · L0）
 * 职责：生成节点/边/事件 id（带类型前缀，便于人读与回指）。
 * ─────────────────────────────────────────────────────────────
 */
import { randomUUID } from 'node:crypto';

/**
 * 生成节点 id。
 *
 * @returns `node_<uuid>`
 */
export function nodeId(): string {
  return `node_${randomUUID()}`;
}

/**
 * 生成边 id。
 *
 * @returns `edge_<uuid>`
 */
export function edgeId(): string {
  return `edge_${randomUUID()}`;
}

/**
 * 生成事件 id（注意：事件的全局顺序由 event-log 的自增 seq 决定，本 id 仅作唯一标识）。
 *
 * @returns `evt_<uuid>`
 */
export function eventId(): string {
  return `evt_${randomUUID()}`;
}
