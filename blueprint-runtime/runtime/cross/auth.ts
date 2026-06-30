/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/cross/auth（鉴权 · 横切）
 * 职责：内存态 bearer token + scoped token 的签发/校验/吊销。
 * ─────────────────────────────────────────────────────────────
 */
import { randomUUID } from 'node:crypto';

/** 一个 token：值 + 作用域。 */
export interface Token {
  readonly value: string;
  readonly scopes: readonly string[];
}

/** token 存储（签发/校验/吊销）。 */
export interface TokenStore {
  issue(scopes: readonly string[]): Token;
  authenticate(value: string): Token | undefined;
  revoke(value: string): void;
}

/**
 * 创建内存态 token 存储。
 *
 * @returns TokenStore
 */
export function createTokenStore(): TokenStore {
  const tokens = new Map<string, Token>();
  return {
    issue(scopes: readonly string[]): Token {
      const t: Token = { value: `tok_${randomUUID()}`, scopes: [...scopes] };
      tokens.set(t.value, t);
      return t;
    },
    authenticate: (value: string): Token | undefined => tokens.get(value),
    revoke: (value: string): void => {
      tokens.delete(value);
    },
  };
}
