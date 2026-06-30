/**
 * runtime/mcp/middleware 单测：组合顺序 + 短路。
 */
import { describe, it, expect } from 'vitest';
import { compose, type Middleware, type Handler } from './middleware';

describe('middleware compose', () => {
  it('runs middlewares in declared order then the handler', () => {
    const calls: string[] = [];
    const mw = (name: string): Middleware => (next) => (req, ctx) => {
      calls.push(name);
      return next(req, ctx);
    };
    const handler: Handler = () => {
      calls.push('handler');
      return { ok: true, value: null };
    };
    compose([mw('auth'), mw('idem'), mw('ctx')], handler)({ name: 't', arguments: {} }, {});
    expect(calls).toEqual(['auth', 'idem', 'ctx', 'handler']);
  });

  it('a middleware can short-circuit (handler not reached)', () => {
    let handlerRan = false;
    const stop: Middleware = () => () => ({ ok: false, error: { code: 'unauthorized', message: 'no' } });
    const handler: Handler = () => {
      handlerRan = true;
      return { ok: true, value: null };
    };
    const out = compose([stop], handler)({ name: 't', arguments: {} }, {});
    expect(out.ok).toBe(false);
    expect(handlerRan).toBe(false);
  });
});
