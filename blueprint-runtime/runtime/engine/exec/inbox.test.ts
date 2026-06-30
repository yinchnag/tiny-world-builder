/**
 * inbox 单测：按 in 口物化已投递载荷。
 */
import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../../persist/sqlite-adapter';
import { append } from '../../persist/event-log';
import { materializeInbox } from './inbox';

describe('materializeInbox', () => {
  it('groups delivered payloads by target in-port', () => {
    const db = openDb();
    migrate(db);
    append(db, { ts: 't', eventType: 'message.delivered', nodeId: 'A', portId: 'context_in', edgeId: 'E', payloadType: 'ContextBundle', payload: { items: ['x'] } });
    append(db, { ts: 't', eventType: 'message.delivered', nodeId: 'A', portId: 'context_in', edgeId: 'E', payloadType: 'ContextBundle', payload: { items: ['y'] } });
    append(db, { ts: 't', eventType: 'message.delivered', nodeId: 'B', portId: 'message_in', edgeId: 'E2', payloadType: 'AgentMessage', payload: { text: 'z' } });

    const inbox = materializeInbox(db, 'A');
    expect(inbox.context_in).toEqual([{ items: ['x'] }, { items: ['y'] }]);
    expect(inbox.message_in).toBeUndefined();
  });
});
