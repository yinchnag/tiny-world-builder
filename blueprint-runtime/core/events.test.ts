/**
 * core/events 单测：地基事件闭集识别 + 共享码表完整性。
 */
import { describe, it, expect } from 'vitest';
import { FOUNDATION_EVENT_TYPES, FEATURE_EVENT_TYPES, isKnownEventType, REASON_CODES } from './events';

describe('events vocabulary', () => {
  it('recognizes every foundation + feature event type', () => {
    for (const t of [...FOUNDATION_EVENT_TYPES, ...FEATURE_EVENT_TYPES]) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('recognizes BP cache events (§5.6 feature registry)', () => {
    expect(isKnownEventType('cache.hit')).toBe(true);
    expect(isKnownEventType('cache.miss')).toBe(true);
  });

  it('rejects unregistered event names', () => {
    expect(isKnownEventType('agent.report')).toBe(false); // 未登记的功能事件
    expect(isKnownEventType('bogus')).toBe(false);
  });

  it('exposes the shared reason codes (§5.7)', () => {
    expect(REASON_CODES).toContain('payload.incompatible');
    expect(REASON_CODES).toContain('payload.schema_invalid');
    expect(REASON_CODES).toContain('contract.invalid');
  });
});
