/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/cross/logger（结构化日志 · 横切）
 * 职责：结构化 JSON 日志 + 敏感字段自动脱敏。
 * ─────────────────────────────────────────────────────────────
 */

const SENSITIVE = ['token', 'password', 'secret', 'authorization', 'apikey'];

/** 结构化日志器。 */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE.includes(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

/**
 * 创建日志器（默认丢弃；测试/生产可注入 sink）。
 *
 * @param sink 行输出回调（默认 no-op）
 * @returns Logger
 */
export function createLogger(sink: (line: string) => void = () => undefined): Logger {
  function emit(level: string, msg: string, fields?: Record<string, unknown>): void {
    sink(JSON.stringify({ level, msg, ...redact(fields ?? {}) }));
  }
  return {
    info: (m: string, f?: Record<string, unknown>): void => emit('info', m, f),
    error: (m: string, f?: Record<string, unknown>): void => emit('error', m, f),
  };
}
