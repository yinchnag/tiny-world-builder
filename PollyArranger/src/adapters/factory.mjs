// adapters/factory.mjs — build a vendor->adapter map for the orchestrator.
//
// Tutorial note:
//   The orchestrator wants `adapters[vendorName]`. This factory routes each
//   vendor to the right adapter:
//     * API vendors (deepseek/openai/qwen/…) → the openai-compatible adapter
//     * harness vendors (claude_code/codex)  → the CLI harness adapter (②)
//   Mock adapters are still constructed directly in tests; this is for real runs.

import { createOpenAICompatibleAdapter, PROVIDERS } from './openai-compatible.mjs';
import { createHarnessAdapter, HARNESS_PRESETS } from './harness.mjs';

/**
 * @param {object} cfg
 * @param {string[]} cfg.vendors   - vendor names (API providers or harness CLIs)
 * @param {string} cfg.repoPath    - repo root (adapters resolve worktrees from it)
 * @param {Function} [cfg.fetchImpl] - injectable fetch for API adapters (tests)
 * @param {Record<string, object>} [cfg.harness] - per-vendor harness overrides (command/shell/runner)
 * @returns {Record<string, object>} vendor -> adapter
 */
export function createRealAdapters({ vendors, repoPath, fetchImpl, harness = {} }) {
  const map = {};
  for (const v of vendors) {
    if (PROVIDERS[v]) {
      map[v] = createOpenAICompatibleAdapter({ provider: v, repoPath, fetchImpl });
    } else if (HARNESS_PRESETS[v]) {
      map[v] = createHarnessAdapter({ vendor: v, repoPath, ...(harness[v] ?? {}) });
    } else {
      throw new Error(
        `unknown vendor "${v}". API providers: ${Object.keys(PROVIDERS).join(', ')}. ` +
        `Harness CLIs: ${Object.keys(HARNESS_PRESETS).join(', ')}.`,
      );
    }
  }
  return map;
}
