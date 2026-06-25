// adapters/mock.mjs — a fake agent backend for testing (docs/04 section 6).
//
// Tutorial note:
//   Every real vendor (claude_code, codex, ...) will implement the SAME contract:
//     implement(task) -> AgentResult   { ok, convId, summary, commits }
//     review(task)    -> ReviewResult   { ok, convId, verdict, findings }
//   (see docs/04 section 2). The MockAdapter returns CANNED results so we can
//   drive the entire orchestrator + state machine with no real models and no
//   network. This is what makes Phase 1 cheap and deterministic: the whole
//   pipeline is exercised before a single token is spent.
//
//   The `verdict` is the contract that drives the state machine's branch
//   (BLOCKING -> FIXING, otherwise -> READY). To exercise the fix loop, pass a
//   reviewPlan that returns BLOCKING then CLEAN for an item.

/**
 * Create a mock agent adapter.
 *
 * @param {object} opts
 * @param {string} opts.vendor          - the vendor name this adapter answers as
 * @param {boolean} [opts.failImplement]- if true, implement() returns ok:false
 * @param {Record<string,string[]>} [opts.reviewPlan]
 *        per-item queue of verdicts consumed in order, e.g. { p1: ['BLOCKING','CLEAN'] }.
 *        Use '*' as a wildcard for all items. Falls back to 'CLEAN'.
 */
export function createMockAdapter({ vendor, failImplement = false, reviewPlan = {}, planItems } = {}) {
  if (!vendor) throw new Error('createMockAdapter: vendor is required');
  let implementSeq = 0;
  const reviewCounts = Object.create(null); // itemId -> how many reviews so far

  return {
    vendor,

    async implement(task) {
      implementSeq += 1;
      if (failImplement) {
        return {
          ok: false,
          convId: task.resumeConvId ?? `conv_${vendor}_impl_${implementSeq}`,
          summary: `mock ${vendor}: implement FAILED`,
          commits: [],
        };
      }
      return {
        ok: true,
        // Resuming a conversation reuses the same id (fix laps continue context).
        convId: task.resumeConvId ?? `conv_${vendor}_impl_${implementSeq}`,
        summary: `mock ${vendor}: ${String(task.spec ?? '').slice(0, 48)}`,
        commits: [`mock${implementSeq}`],
      };
    },

    async plan(/* task */) {
      // Canned backlog (override via createMockAdapter({ planItems })).
      return {
        ok: true,
        items: planItems ?? [{ id: 't1', title: 'Mock task', spec: 'do the thing' }],
        usage: { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },

    async review(task) {
      const id = task.itemId ?? '*';
      const n = reviewCounts[id] ?? 0;
      reviewCounts[id] = n + 1;
      const plan = reviewPlan[id] ?? reviewPlan['*'] ?? [];
      const verdict = plan[n] ?? 'CLEAN'; // default: approve
      const findings =
        verdict === 'BLOCKING'
          ? [{ severity: 'blocking', where: 'mock.js:1', what: `mock blocking finding #${n + 1}` }]
          : [];
      return {
        ok: true,
        convId: `conv_${vendor}_rev_${id}_${n + 1}`,
        verdict,
        findings,
      };
    },
  };
}
