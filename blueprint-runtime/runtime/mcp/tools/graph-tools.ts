/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/mcp/tools/graph-tools（图变更 + 投递工具 · L5 · 功能阶段 BP-2）
 * 职责：编辑器经 MCP 镜像图并触发投递——
 *   create_node：记 nodeId→契约类型（供端口解析）
 *   create_edge：记一条端口级边
 *   deliver    ：沿边路由载荷（= message-bus.route，运行期类型防线）→ 追加事件 → SSE 推送
 * 复用既有事件词表（message.delivered/rejected，§5.6），不新增事件类型。
 * ─────────────────────────────────────────────────────────────
 */
import { createEdge, lookup, type Edge, type Lane, type Port } from '../../../core/index';
import { route } from '../../engine/message-bus';
import { append, type EventInput } from '../../persist/event-log';
import { runNode, type NodeMeta } from '../../engine/exec/run';
import type { ExecutorRegistry } from '../../engine/exec/executor';
import type { Db } from '../../persist/sqlite-adapter';
import type { Clock } from '../../kernel/clock';
import type { SseHub } from '../sse';
import type { ToolRegistry } from './registry';
import type { ToolOutcome } from '../middleware';

/** 图工具依赖：事件主存 + 事件流 + 时钟 + 执行器注册表。 */
export interface GraphToolsDeps {
  readonly db: Db;
  readonly hub: SseHub;
  readonly clock: Clock;
  readonly executors: ExecutorRegistry;
}

function resolvePort(nodes: Map<string, NodeMeta>, nodeId: string, portId: string): Port | undefined {
  const meta = nodes.get(nodeId);
  if (meta === undefined) return undefined;
  const contract = lookup(meta.type);
  if (contract === undefined) return undefined;
  return [...contract.inputs, ...contract.outputs].find((p) => p.id === portId);
}

/**
 * 登记 create_node/create_edge/deliver 到工具注册表。
 *
 * @param registry 工具注册表
 * @param deps 事件主存/事件流/时钟
 * @returns void
 */
export function registerGraphTools(registry: ToolRegistry, deps: GraphToolsDeps): void {
  const nodes = new Map<string, NodeMeta>();
  const edges = new Map<string, Edge>();

  registry.register({
    name: 'create_node',
    mutates: true,
    adminOnly: false,
    handler: (req): ToolOutcome => {
      const a = req.arguments as { id: string; type: string; properties?: Record<string, unknown> };
      nodes.set(a.id, { type: a.type, properties: a.properties ?? {} });
      return { ok: true, value: { created: a.id } };
    },
  });

  registry.register({
    name: 'create_edge',
    mutates: true,
    adminOnly: false,
    handler: (req): ToolOutcome => {
      const a = req.arguments as {
        id: string;
        source: { node: string; port: string };
        target: { node: string; port: string };
        lane: Lane;
        payloadType: string;
      };
      const edge = createEdge({ id: a.id, source: a.source, target: a.target, lane: a.lane, payloadType: a.payloadType });
      edges.set(edge.id, edge);
      return { ok: true, value: { created: edge.id } };
    },
  });

  registry.register({
    name: 'deliver',
    mutates: true,
    adminOnly: false,
    handler: (req): ToolOutcome => {
      const a = req.arguments as { edgeId: string; payload: unknown };
      const edge = edges.get(a.edgeId);
      if (edge === undefined) return { ok: false, error: { code: 'deliver.edge_missing', message: `未知边 ${a.edgeId}` } };
      const src = resolvePort(nodes, edge.source.node, edge.source.port);
      const tgt = resolvePort(nodes, edge.target.node, edge.target.port);
      if (src === undefined || tgt === undefined) {
        return { ok: false, error: { code: 'deliver.port_missing', message: '端口未解析（先 create_node）' } };
      }
      const result = route(edge, src, tgt, a.payload, deps.clock);
      const ev = append(deps.db, result.event);
      deps.hub.push(ev);
      if (result.delivered) return { ok: true, value: { seq: ev.seq, eventType: ev.eventType } };
      return { ok: false, error: { code: 'message.rejected', message: `投递被拒 (seq=${ev.seq})` } };
    },
  });

  registry.register({
    name: 'run_node',
    mutates: true,
    adminOnly: false,
    handler: (req): ToolOutcome => {
      const a = req.arguments as { nodeId: string };
      const emit = (ev: EventInput): void => {
        deps.hub.push(append(deps.db, ev));
      };
      // 触发即返回；执行 async 进行，结果经 SSE 事件回流（D2 手动激活）。
      void runNode({ db: deps.db, clock: deps.clock, executors: deps.executors, nodes, edges, emit }, a.nodeId);
      return { ok: true, value: { started: true } };
    },
  });
}
