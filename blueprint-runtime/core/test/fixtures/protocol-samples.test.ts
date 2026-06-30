/**
 * protocol-samples 自洽性测试：样本符合 00 §5.8 封套约定。
 * （两支的「接受/产出」契约测试在 F3/F5 transport·mcp-client 落地时补。）
 */
import { describe, it, expect } from 'vitest';
import { REQ_CALL, RES_OK, RES_FAIL, ERR_PROTO, SSE_FRAME, RES_READ } from './protocol-samples';
import { isKnownEventType, REASON_CODES } from '../../events';

describe('protocol-samples (§5.8)', () => {
  it('REQ_CALL is a tools/call with idempotency + correlation meta', () => {
    expect(REQ_CALL.method).toBe('tools/call');
    const meta = REQ_CALL.params._meta as { idempotencyKey: string; correlationId: string };
    expect(meta.idempotencyKey).toBeTruthy();
    expect(meta.correlationId).toBeTruthy();
  });

  it('business failure rides result.ok:false with a §5.7 code', () => {
    expect(RES_OK.result.ok).toBe(true);
    expect(RES_FAIL.result.ok).toBe(false);
    if (!RES_FAIL.result.ok) expect(REASON_CODES).toContain(RES_FAIL.result.error.code);
  });

  it('protocol error rides JSON-RPC error with a numeric code', () => {
    expect(typeof ERR_PROTO.error.code).toBe('number');
  });

  it('SSE frame carries a known event type and seq id', () => {
    expect(isKnownEventType(SSE_FRAME.event)).toBe(true);
    expect(SSE_FRAME.id).toBe((SSE_FRAME.data as { seq: number }).seq);
  });

  it('resources/read returns a context:// projection view', () => {
    if (RES_READ.result.ok) {
      expect((RES_READ.result.value as { uri: string }).uri.startsWith('context://')).toBe(true);
    }
  });
});
