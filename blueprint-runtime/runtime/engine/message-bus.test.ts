/**
 * runtime/engine/message-bus 单测：运行期类型防线（与编辑期同一 core/validate）。
 * 复用黄金夹具端口（testing/00 §3）。
 */
import { describe, it, expect } from 'vitest';
import { route } from './message-bus';
import { createEdge } from '../../core/graph/edge';
import { fixedClock } from '../kernel/clock';
import { PORTS } from '../../core/test/fixtures/golden-graph';

const CLOCK = fixedClock('2026-06-30T00:00:00.000Z');
const E1 = createEdge({ id: 'E1', source: { node: 'A', port: 'report_out' }, target: { node: 'B', port: 'message_in' }, lane: 'message', payloadType: 'AgentReport' });
const X1 = createEdge({ id: 'X1', source: { node: 'H', port: 'reply_out' }, target: { node: 'H', port: 'question_in' }, lane: 'human', payloadType: 'HumanReply' });
const X3 = createEdge({ id: 'X3', source: { node: 'D', port: 'selection_out' }, target: { node: 'A', port: 'message_in' }, lane: 'context', payloadType: 'DocumentSelection' });

describe('message-bus route', () => {
  it('routes a compatible payload → message.delivered', () => {
    const r = route(E1, PORTS.report_out, PORTS.message_in, { summary: 'done' }, CLOCK);
    expect(r.delivered).toBe(true);
    expect(r.event).toMatchObject({ eventType: 'message.delivered', edgeId: 'E1' });
  });

  it('rejects incompatible (X1) → payload.incompatible, not delivered', () => {
    const r = route(X1, PORTS.reply_out, PORTS.question_in, { text: 'x' }, CLOCK);
    expect(r.delivered).toBe(false);
    expect(r.event).toMatchObject({ eventType: 'message.rejected', payload: { reason: 'payload.incompatible' } });
  });

  it('rejects lane mismatch (X3) → lane.mismatch', () => {
    const r = route(X3, PORTS.selection_out, PORTS.message_in, { text: 'x' }, CLOCK);
    expect((r.event.payload as { reason: string }).reason).toBe('lane.mismatch');
  });

  it('rejects a payload failing its schema → payload.schema_invalid', () => {
    const r = route(E1, PORTS.report_out, PORTS.message_in, { nope: 1 }, CLOCK);
    expect(r.delivered).toBe(false);
    expect((r.event.payload as { reason: string }).reason).toBe('payload.schema_invalid');
  });
});
