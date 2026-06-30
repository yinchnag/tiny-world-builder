/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/resources（MCP 资源 · L5）
 * 职责：把投影视图暴露为 context://... 只读资源（读投影，从不直接读表）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Db } from '../persist/sqlite-adapter';
import { rebuild } from '../persist/projections/index';
import { nodesProjection } from '../persist/projections/nodes';
import { timeline } from '../cross/audit';

/** 资源读取结果。 */
export interface ResourceResult {
  readonly ok: boolean;
  readonly uri: string;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * 读取一个 context:// 资源（只读投影视图）。
 *
 * 支持：context://&lt;ws&gt;/graph（节点状态）、context://&lt;ws&gt;/timeline（事件）。
 *
 * @param db 数据库句柄
 * @param uri 资源 URI
 * @returns 资源结果
 */
export function readResource(db: Db, uri: string): ResourceResult {
  const m = /^context:\/\/[^/]+\/(.+)$/.exec(uri);
  if (m === null) return { ok: false, uri, error: { code: 'port.not_found', message: 'bad uri' } };
  const view = m[1];
  if (view === 'graph') return { ok: true, uri, value: { nodes: rebuild(db, nodesProjection) } };
  if (view === 'timeline') return { ok: true, uri, value: { events: timeline(db) } };
  return { ok: false, uri, error: { code: 'port.not_found', message: `unknown view: ${view}` } };
}
