/**
 * graph-tools 单测：create_node/create_edge/deliver 路由载荷并推 message.delivered。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate } from '../../persist/sqlite-adapter';
import { createSseHub } from '../sse';
import { createToolRegistry } from './registry';
import { registerGraphTools } from './graph-tools';
import { fixedClock } from '../../kernel/clock';
import { registerBuiltinContracts, type RuntimeEvent } from '../../../core/index';
import type { ToolDef } from './registry';

beforeAll(() => registerBuiltinContracts());

const CTX = {};
function call(def: ToolDef | undefined, args: Record<string, unknown>): ReturnType<ToolDef['handler']> {
  if (def === undefined) throw new Error('tool not registered');
  return def.handler({ name: def.name, arguments: args }, CTX);
}

describe('graph tools', () => {
  it('mirrors nodes/edge then delivers a payload → message.delivered pushed', () => {
    const db = openDb();
    migrate(db);
    const hub = createSseHub();
    const events: RuntimeEvent[] = [];
    hub.subscribe((e) => events.push(e));
    const reg = createToolRegistry();
    registerGraphTools(reg, { db, hub, clock: fixedClock('2026-06-30T00:00:00.000Z') });

    call(reg.lookup('create_node'), { id: 'D', type: 'document' });
    call(reg.lookup('create_node'), { id: 'A', type: 'agent' });
    call(reg.lookup('create_edge'), {
      id: 'E1',
      source: { node: 'D', port: 'selection_out' },
      target: { node: 'A', port: 'context_in' },
      lane: 'context',
      payloadType: 'DocumentSelection',
    });
    const out = call(reg.lookup('deliver'), { edgeId: 'E1', payload: { text: 'hello' } });

    expect(out.ok).toBe(true);
    expect(events.some((e) => e.eventType === 'message.delivered' && e.edgeId === 'E1')).toBe(true);
  });

  it('deliver on an unknown edge fails', () => {
    const db = openDb();
    migrate(db);
    const reg = createToolRegistry();
    registerGraphTools(reg, { db, hub: createSseHub(), clock: fixedClock('2026-06-30T00:00:00.000Z') });
    expect(call(reg.lookup('deliver'), { edgeId: 'nope', payload: {} }).ok).toBe(false);
  });
});
