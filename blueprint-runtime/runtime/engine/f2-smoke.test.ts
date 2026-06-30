/**
 * F2 冒烟：喂「A 产出 → 经边 → B」序列，断言 message.delivered + 状态推进。
 * 串起 node-machine + message-bus + event-log + projections。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../persist/sqlite-adapter';
import { append, scan } from '../persist/event-log';
import { rebuild } from '../persist/projections/index';
import { nodesProjection } from '../persist/projections/nodes';
import { transition } from './node-machine';
import { route } from './message-bus';
import { createNode } from '../../core/graph/node';
import { createEdge } from '../../core/graph/edge';
import { fixedClock } from '../kernel/clock';
import { PORTS } from '../../core/test/fixtures/golden-graph';
import type { NodeContract } from '../../core/contracts/registry';

const CONTRACT: NodeContract = {
  type: 'agent',
  family: 'execution',
  inputs: [],
  outputs: [],
  state: { values: ['idle', 'working', 'done'], initial: 'idle', transitions: [['idle', 'working', 'start']] },
  runtime: 'contex',
};

describe('F2 smoke', () => {
  it('advances A and delivers A → B over an edge', () => {
    const db = openDb();
    migrate(db);
    const clock = fixedClock('2026-06-30T00:00:00.000Z');

    // A: idle → working（产出 node.transitioned）
    const t = transition(createNode({ id: 'A', type: 'agent', state: 'idle' }), CONTRACT, 'start', clock);
    expect(t.ok).toBe(true);
    if (t.ok) append(db, t.value.event);

    // 经边 A.report_out → B.message_in 投递
    const edge = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
    const r = route(edge, PORTS.report_out, PORTS.message_in, { summary: 'done' }, clock);
    expect(r.delivered).toBe(true);
    append(db, r.event);

    // 断言：节点状态推进 + 事件序列
    expect(rebuild(db, nodesProjection)).toEqual({ A: 'working' });
    expect(scan(db).map((e) => e.eventType)).toEqual(['node.transitioned', 'message.delivered']);
  });
});
