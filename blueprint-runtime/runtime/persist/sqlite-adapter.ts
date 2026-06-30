/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/persist/sqlite-adapter（sqlite 适配 · L3）
 * 职责：包裹 Node 原生 node:sqlite——打开库、迁移建表、暴露预编译入口。
 *       状态不直接存这里；这里只放事件溯源主存 event_log 的物理表。
 *
 * 迁移：只增表/列，向前兼容（10 §7）。
 * ─────────────────────────────────────────────────────────────
 */
import { DatabaseSync } from 'node:sqlite';

/** 数据库句柄类型别名。 */
export type Db = DatabaseSync;

/**
 * 打开数据库（默认内存库，测试用；生产传文件路径）。
 *
 * @param path 数据库路径，默认 ':memory:'
 * @returns 数据库句柄
 */
export function openDb(path = ':memory:'): Db {
  return new DatabaseSync(path);
}

/**
 * 迁移：建 event_log 主存表（事件溯源；只追加）。
 *
 * @param db 数据库句柄
 * @returns void
 */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      node_id TEXT,
      port_id TEXT,
      edge_id TEXT,
      workflow_template_id TEXT,
      workflow_instance_id TEXT,
      payload_type TEXT,
      payload_json TEXT,
      correlation_id TEXT
    )
  `);
}
