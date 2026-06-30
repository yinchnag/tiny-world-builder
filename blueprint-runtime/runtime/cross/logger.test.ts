/**
 * runtime/cross/logger 单测：结构化输出 + 脱敏。
 */
import { describe, it, expect } from 'vitest';
import { createLogger } from './logger';

describe('logger', () => {
  it('emits structured JSON and redacts sensitive fields', () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    log.info('hello', { token: 'secret-123', user: 'A' });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.token).toBe('[redacted]');
    expect(parsed.user).toBe('A');
  });
});
