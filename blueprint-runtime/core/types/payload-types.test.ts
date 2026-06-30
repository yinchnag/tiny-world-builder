/**
 * core/types/payload-types 单测：注册/查询/lane 映射 + lane 合法性。
 */
import { describe, it, expect } from 'vitest';
import {
  LANES,
  lookupPayloadType,
  isRegisteredPayloadType,
  laneOf,
  payloadLaneMap,
} from './payload-types';

describe('payload-types', () => {
  it('looks up a registered type with its lane and schema', () => {
    const t = lookupPayloadType('AgentMessage');
    expect(t?.lane).toBe('message');
    expect(t?.schema).not.toBeNull();
  });

  it('reports registration status', () => {
    expect(isRegisteredPayloadType('AgentReport')).toBe(true);
    expect(isRegisteredPayloadType('Nope')).toBe(false);
  });

  it('registers HandoffRequest on the task lane with a field schema (BP-1)', () => {
    const t = lookupPayloadType('HandoffRequest');
    expect(t?.lane).toBe('task');
    expect(t?.schema?.safeParse({ targetRole: 'reviewer', reason: 'needs review' }).success).toBe(true);
    expect(t?.schema?.safeParse({ targetRole: 'reviewer' }).success).toBe(false);
  });

  it('laneOf returns lane or undefined', () => {
    expect(laneOf('ContextBundle')).toBe('context');
    expect(laneOf('Nope')).toBeUndefined();
  });

  it('payloadLaneMap covers every type with a valid lane', () => {
    const map = payloadLaneMap();
    expect(map.AgentReport).toBe('message');
    for (const lane of Object.values(map)) {
      expect(LANES).toContain(lane);
    }
  });
});
