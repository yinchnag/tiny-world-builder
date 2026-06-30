/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/tools/registry（工具注册表 · L5）
 * 职责：name → {handler, mutates, adminOnly} 的注册/查询/列举。
 *       具体工具 handler（agent_* / task_* 等）属功能阶段，按域分文件登记进本表。
 * ─────────────────────────────────────────────────────────────
 */
import type { Handler } from '../middleware';

/** 工具定义。 */
export interface ToolDef {
  readonly name: string;
  /** 是否 mutating（true 才需幂等键）。 */
  readonly mutates: boolean;
  readonly adminOnly: boolean;
  readonly handler: Handler;
}

/** 工具注册表。 */
export interface ToolRegistry {
  register(def: ToolDef): void;
  lookup(name: string): ToolDef | undefined;
  list(): ToolDef[];
}

/**
 * 创建工具注册表。
 *
 * @returns ToolRegistry
 */
export function createToolRegistry(): ToolRegistry {
  const map = new Map<string, ToolDef>();
  return {
    register: (def: ToolDef): void => {
      map.set(def.name, def);
    },
    lookup: (name: string): ToolDef | undefined => map.get(name),
    list: (): ToolDef[] => [...map.values()],
  };
}
