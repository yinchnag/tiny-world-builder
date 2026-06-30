/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/browser（Browser 节点契约 · 观察家族）
 * 职责：把浏览器观察声明为节点（node-evolution §5）。
 *       finding_out 走 context 且可赋 ContextBundle → 可喂 Agent.context_in。
 *       runtime=editor：内嵌预览在编辑器侧。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Browser 观察节点契约（发出浏览发现）。 */
export const BROWSER_CONTRACT: NodeContract = {
  type: 'browser',
  family: 'observation',
  runtime: 'editor',
  inputs: [],
  outputs: [
    createPort({ id: 'finding_out', dir: 'out', payloadType: 'BrowserFinding', lane: 'context', multiple: true }),
  ],
  state: {
    values: ['idle', 'observing'],
    initial: 'idle',
    transitions: [
      ['idle', 'observing', 'observe'],
      ['observing', 'idle', 'reset'],
    ],
  },
};
