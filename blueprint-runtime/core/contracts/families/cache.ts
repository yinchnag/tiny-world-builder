/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/cache（Cache 节点契约 · execution 家族 · vision §7）
 * 职责：把「精确记忆化」声明为可见、可旁路、可审计的图单元。
 *       input_in/result_out 走 context（包一层缓存：Document/Memory → Cache → Agent）；
 *       bypass_in 走 control（强制未命中）。运行期机制见 runtime/engine/memoize。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Cache 节点契约（精确记忆化包装）。 */
export const CACHE_CONTRACT: NodeContract = {
  type: 'cache',
  family: 'execution',
  runtime: 'contex',
  inputs: [
    createPort({ id: 'input_in', dir: 'in', payloadType: 'ContextBundle', lane: 'context', multiple: true }),
    createPort({ id: 'bypass_in', dir: 'in', payloadType: 'CacheBypass', lane: 'control' }),
  ],
  outputs: [
    createPort({ id: 'result_out', dir: 'out', payloadType: 'ContextBundle', lane: 'context', multiple: true }),
  ],
  state: {
    values: ['idle', 'checking', 'computing'],
    initial: 'idle',
    transitions: [
      ['idle', 'checking', 'check'],
      ['checking', 'idle', 'hit'],
      ['checking', 'computing', 'miss'],
      ['computing', 'idle', 'done'],
    ],
  },
};
