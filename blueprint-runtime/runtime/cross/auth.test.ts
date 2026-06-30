/**
 * runtime/cross/auth 单测：签发/校验/吊销 + scope。
 */
import { describe, it, expect } from 'vitest';
import { createTokenStore } from './auth';

describe('auth token store', () => {
  it('issues and authenticates a token with scopes', () => {
    const store = createTokenStore();
    const t = store.issue(['read', 'write']);
    expect(store.authenticate(t.value)?.scopes).toEqual(['read', 'write']);
  });

  it('rejects unknown tokens and revoked tokens', () => {
    const store = createTokenStore();
    const t = store.issue(['read']);
    expect(store.authenticate('bogus')).toBeUndefined();
    store.revoke(t.value);
    expect(store.authenticate(t.value)).toBeUndefined();
  });
});
