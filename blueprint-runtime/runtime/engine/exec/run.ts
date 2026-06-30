/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/exec/run（手动激活编排 · L4 · EX-0）
 * 职责：run_node 触发——物化输入 → 跑执行器 → 输出沿出边投递(route 运行期类型防线)
 *       → 推进状态 → 发 exec.started/completed/failed。全程经 emit（append+push）回流 SSE。
 *       emit 注入（不直接依赖 mcp/sse），避免 engine→mcp 反向依赖。
 * ─────────────────────────────────────────────────────────────
 */
import { route } from '../message-bus';
import { rebuild } from '../../persist/projections/index';
import { nodesProjection } from '../../persist/projections/nodes';
import { lookup, type Edge, type Port } from '../../../core/index';
import type { Db } from '../../persist/sqlite-adapter';
import type { Clock } from '../../kernel/clock';
import type { EventInput } from '../../persist/event-log';
import { materializeInbox } from './inbox';
import type { ExecutorRegistry, ExecOutput, ExecResult } from './executor';

/** 节点元信息（type + properties）。 */
export interface NodeMeta {
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

/** runNode 依赖（emit 注入：append+push 由调用方接）。 */
export interface RunDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly executors: ExecutorRegistry;
  readonly nodes: ReadonlyMap<string, NodeMeta>;
  readonly edges: ReadonlyMap<string, Edge>;
  readonly emit: (ev: EventInput) => void;
}

function portOf(type: string | undefined, portId: string): Port | undefined {
  if (type === undefined) return undefined;
  const c = lookup(type);
  if (c === undefined) return undefined;
  return [...c.inputs, ...c.outputs].find((p) => p.id === portId);
}

// 把一条执行器输出沿匹配的出边投递（route 校验 + 产 message.delivered）。
function propagate(deps: RunDeps, nodeId: string, sourceType: string, out: ExecOutput): void {
  for (const edge of deps.edges.values()) {
    if (edge.source.node !== nodeId || edge.source.port !== out.port) continue;
    const src = portOf(sourceType, edge.source.port);
    const tgt = portOf(deps.nodes.get(edge.target.node)?.type, edge.target.port);
    if (src === undefined || tgt === undefined) continue;
    deps.emit(route(edge, src, tgt, out.payload, deps.clock).event);
  }
}

/**
 * 手动激活一个节点（async，调用方可 fire-and-forget）。
 *
 * @param deps 运行依赖
 * @param nodeId 目标节点
 * @returns 是否真的跑了（无 meta / 无执行器 → false）
 */
export async function runNode(deps: RunDeps, nodeId: string): Promise<boolean> {
  const meta = deps.nodes.get(nodeId);
  const exec = meta ? deps.executors.lookup(meta.type) : undefined;
  if (meta === undefined || exec === undefined) return false;

  const state = rebuild(deps.db, nodesProjection)[nodeId] ?? '';
  deps.emit({ ts: deps.clock.nowIso(), eventType: 'exec.started', nodeId });

  let result: ExecResult;
  try {
    result = await exec({
      node: { id: nodeId, type: meta.type, state, properties: meta.properties },
      inputs: materializeInbox(deps.db, nodeId),
      clock: deps.clock,
    });
  } catch (err) {
    deps.emit({ ts: deps.clock.nowIso(), eventType: 'exec.failed', nodeId, payload: { message: String(err) } });
    return true;
  }

  for (const ev of result.events ?? []) deps.emit(ev);
  for (const out of result.outputs) propagate(deps, nodeId, meta.type, out);
  if (result.nextState !== undefined) {
    deps.emit({ ts: deps.clock.nowIso(), eventType: 'node.transitioned', nodeId, payload: { from: state, to: result.nextState } });
  }
  deps.emit({ ts: deps.clock.nowIso(), eventType: 'exec.completed', nodeId });
  return true;
}
