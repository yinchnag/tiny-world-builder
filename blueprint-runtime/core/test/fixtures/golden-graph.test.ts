/**
 * 黄金夹具自洽性测试：正/反例对与 canConnect 一致，事件序列合法。
 */
import { describe, it, expect } from 'vitest';
import { GOLDEN_GRAPH, POSITIVE_PAIRS, NEGATIVE_PAIRS, EVENT_SEQUENCE } from './golden-graph';
import { listNodes, listEdges } from '../../graph/graph';
import { canConnect } from '../../validate';
import { isKnownEventType, REASON_CODES } from '../../events';

describe('golden-graph fixture', () => {
  it('has the standard 4 nodes and 2 edges', () => {
    expect(listNodes(GOLDEN_GRAPH)).toHaveLength(4);
    expect(listEdges(GOLDEN_GRAPH).map((e) => e.id).sort()).toEqual(['E1', 'E2']);
  });

  it('positive pairs all connect', () => {
    for (const p of POSITIVE_PAIRS) {
      expect(canConnect(p.source, p.target)).toEqual({ ok: true });
    }
  });

  it('negative pairs yield their declared reason code', () => {
    for (const p of NEGATIVE_PAIRS) {
      expect(canConnect(p.source, p.target).reason).toBe(p.reason);
    }
  });

  it('event sequence is strictly increasing with known event types', () => {
    let prev = 0;
    for (const ev of EVENT_SEQUENCE) {
      expect(ev.seq).toBeGreaterThan(prev);
      prev = ev.seq;
      expect(isKnownEventType(ev.eventType)).toBe(true);
    }
    const rejected = EVENT_SEQUENCE.find((e) => e.eventType === 'message.rejected');
    expect(REASON_CODES).toContain((rejected?.payload as { reason: string }).reason);
  });
});
