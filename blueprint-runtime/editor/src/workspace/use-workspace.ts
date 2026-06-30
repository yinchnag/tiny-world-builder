/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/workspace/use-workspace（工作区加载/保存 · L-Workspace）
 * 职责：把图文档序列化存取（端口可注入：localStorage / 后端 server）。
 * ─────────────────────────────────────────────────────────────
 */
import type { FlowNode, FlowEdge } from '../lib/flow-types';

/** 工作区快照。 */
export interface WorkspaceSnapshot {
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
}

/** 存储端口（read/write 字符串；可接 localStorage 或后端）。 */
export interface WorkspacePort {
  read(): string | null;
  write(data: string): void;
}

/**
 * 保存工作区快照。
 *
 * @param port 存储端口
 * @param snap 快照
 * @returns void
 */
export function saveWorkspace(port: WorkspacePort, snap: WorkspaceSnapshot): void {
  port.write(JSON.stringify(snap));
}

/**
 * 加载工作区快照（无则 null）。
 *
 * @param port 存储端口
 * @returns 快照或 null
 */
export function loadWorkspace(port: WorkspacePort): WorkspaceSnapshot | null {
  const raw = port.read();
  return raw === null ? null : (JSON.parse(raw) as WorkspaceSnapshot);
}
