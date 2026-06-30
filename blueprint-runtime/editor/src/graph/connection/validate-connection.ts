/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/graph/connection/validate-connection（编辑期类型防线）
 * 职责：由 xyflow 连接定位两端 Port → 调 core/validate.canConnect。
 *       与运行期 message-bus 用的是**同一函数**（00 §2.2），消灭前后端漂移。
 * ─────────────────────────────────────────────────────────────
 */
import type { Connection } from '@xyflow/react';
import { canConnect, type Port, type CheckResult } from '@blueprint/core';

/** 由 (nodeId, portId) 取端口定义（来自契约/节点类型）。 */
export type PortResolver = (nodeId: string, portId: string) => Port | undefined;

/**
 * 校验一条 xyflow 连接是否合法（含拒绝原因码）。
 *
 * @param conn xyflow 连接
 * @param resolve 端口解析器
 * @param opts 选项（targetOccupied 用于基数判定）
 * @param opts.targetOccupied 目标 in 口是否已被占用
 * @returns 校验结果（不通过带 §5.7 码）
 */
export function checkConnection(
  conn: Connection,
  resolve: PortResolver,
  opts: { targetOccupied?: boolean } = {},
): CheckResult {
  const source = conn.source !== null && conn.sourceHandle != null ? resolve(conn.source, conn.sourceHandle) : undefined;
  const target = conn.target !== null && conn.targetHandle != null ? resolve(conn.target, conn.targetHandle) : undefined;
  return canConnect(source, target, opts);
}
