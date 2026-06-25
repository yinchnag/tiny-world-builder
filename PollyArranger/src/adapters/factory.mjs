// adapters/factory.mjs — build a vendor->adapter map for the orchestrator.
//
// Tutorial note:
//   The orchestrator wants `adapters[vendorName]`. This factory builds that map
//   for the REAL providers (anything in PROVIDERS — deepseek, openai, qwen, …),
//   each backed by the one generic openai-compatible adapter. Mock adapters are
//   still constructed directly in tests; this is only for real runs.

import { createOpenAICompatibleAdapter, PROVIDERS } from './openai-compatible.mjs';

/**
 * @param {object} cfg
 * @param {string[]} cfg.vendors   - vendor names (must each be in PROVIDERS)
 * @param {string} cfg.repoPath    - repo root (adapters resolve worktrees from it)
 * @param {Function} [cfg.fetchImpl] - injectable fetch (tests)
 * @returns {Record<string, object>} vendor -> adapter
 */
export function createRealAdapters({ vendors, repoPath, fetchImpl }) {
  const map = {};
  for (const v of vendors) {
    if (!PROVIDERS[v]) {
      throw new Error(
        `vendor "${v}" has no OpenAI-compatible provider config ` +
        `(known: ${Object.keys(PROVIDERS).join(', ')}). Harness adapters (claude_code/codex) are not wired yet.`,
      );
    }
    map[v] = createOpenAICompatibleAdapter({ provider: v, repoPath, fetchImpl });
  }
  return map;
}
