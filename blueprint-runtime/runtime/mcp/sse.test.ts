/**
 * runtime/mcp/sse 单测：订阅扇出 + Last-Event-ID 重放 + 帧格式。
 */
import { describe, it, expect } from 'vitest';
import { createSseHub, toSseFrame } from './sse';
import type { RuntimeEvent } from '../../core/events';

function ev(seq: number, eventType = 'message.delivered'): RuntimeEvent {
  return { seq, ts: 't', eventType, edgeId: 'E1' };
}

describe('sse hub', () => {
  it('fans out pushed events to subscribers and unsubscribes', () => {
    const hub = createSseHub();
    const seen: number[] = [];
    const unsub = hub.subscribe((e) => seen.push(e.seq));
    hub.push(ev(1));
    unsub();
    hub.push(ev(2));
    expect(seen).toEqual([1]);
  });

  it('replays buffered events after a given seq', () => {
    const hub = createSseHub();
    hub.push(ev(1));
    hub.push(ev(2));
    hub.push(ev(3));
    expect(hub.replaySince(1).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('formats an SSE frame (id=seq, event=eventType)', () => {
    const frame = toSseFrame(ev(3, 'message.delivered'));
    expect(frame.id).toBe(3);
    expect(frame.event).toBe('message.delivered');
    expect(frame.data.seq).toBe(3);
  });
});
