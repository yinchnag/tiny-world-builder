/**
 * run 单测：runNode 物化输入 → 跑执行器 → 输出沿出边投递 → 发 exec.* 事件。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate } from '../../persist/sqlite-adapter';
import { append } from '../../persist/event-log';
import { fixedClock } from '../../kernel/clock';
import { createExecutorRegistry } from './executor';
import { runNode, type RunDeps, type NodeMeta } from './run';
import { registerBuiltinContracts, createEdge, type Edge, type RuntimeEvent } from '../../../core/index';

beforeAll(() => registerBuiltinContracts());

describe('runNode', () => {
  it('materializes inputs, runs the executor, propagates outputs, emits exec.*', async () => {
    const db = openDb();
    migrate(db);
    const clock = fixedClock('2026-06-30T00:00:00.000Z');
    const events: RuntimeEvent[] = [];
    const emit = (ev: Parameters<RunDeps['emit']>[0]): void => {
      events.push(append(db, ev));
    };

    // 预投递一条到 A.context_in（模拟上游已送）
    emit({ ts: clock.nowIso(), eventType: 'message.delivered', nodeId: 'A', portId: 'context_in', edgeId: 'E0', payloadType: 'ContextBundle', payload: { items: ['ctx'] } });

    let sawInput: unknown;
    const executors = createExecutorRegistry();
    executors.register('agent', async (input) => {
      sawInput = input.inputs.context_in;
      return { outputs: [{ port: 'report_out', payload: { summary: 'echo' } }], nextState: 'reporting' };
    });

    const nodes = new Map<string, NodeMeta>([
      ['A', { type: 'agent', properties: {} }],
      ['B', { type: 'agent', properties: {} }],
    ]);
    const edges = new Map<string, Edge>([
      ['E1', createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' })],
    ]);

    const deps: RunDeps = { db, clock, executors, nodes, edges, emit };
    const ran = await runNode(deps, 'A');

    expect(ran).toBe(true);
    expect(sawInput).toEqual([{ items: ['ctx'] }]);

    const types = events.map((e) => e.eventType);
    expect(types).toContain('exec.started');
    expect(types).toContain('exec.completed');
    expect(types).toContain('node.transitioned');
    // 输出沿 E1 投递到 B.message_in
    expect(events.some((e) => e.eventType === 'message.delivered' && e.nodeId === 'B' && e.portId === 'message_in')).toBe(true);
  });

  it('returns false when no executor is registered for the type', async () => {
    const db = openDb();
    migrate(db);
    const deps: RunDeps = {
      db,
      clock: fixedClock('2026-06-30T00:00:00.000Z'),
      executors: createExecutorRegistry(),
      nodes: new Map([['A', { type: 'agent', properties: {} }]]),
      edges: new Map(),
      emit: () => {},
    };
    expect(await runNode(deps, 'A')).toBe(false);
  });
});
