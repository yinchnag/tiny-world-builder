# 06 — Roadmap (build order)

> The design is settled enough to build. This doc is the *order* to build it in,
> chosen so that you have something working as early as possible and add risk
> only when the foundation is proven. Each phase ends with a concrete,
> demonstrable result.

Guiding rule: **the minimal closed loop first.** Get one item to go
`PLANNED → MERGED` with *mock* agents before you touch a real model. Then swap in
real agents. Then add parallelism, waves, and polish.

---

## Phase 0 — Decide the runtime (the one open decision)

**Goal:** pick the language/stack so code can start.

The docs are stack-neutral on purpose. The recommendation, with reasons:

- **Node.js ESM (`.mjs`)** — *recommended.* It reuses what the parent project
  already has: `@anthropic-ai/claude-agent-sdk` is a dependency, the `tools/*.mjs`
  scripts establish the style, and there's no bundler to fight. Fastest path to a
  running loop.
- **Node.js + TypeScript** — better types, but adds a build step to a repo that
  is deliberately zero-build. Choose only if the team strongly prefers it.

**Deliverable:** a decision recorded here, plus an empty `src/` skeleton and a
`package.json` for PollyArranger.

> **Status: DONE.** Decision: **Node.js ESM (`.mjs`)**, to stay consistent with
> the parent project (reuses `@anthropic-ai/claude-agent-sdk`, matches
> `tools/*.mjs` style, zero build step). `package.json`, `src/` skeleton, and the
> cross-session continuity files (`PROGRESS.md`, `AGENTS.md`) are in place.
> Next session starts at **Phase 1**.

---

## Phase 1 — The closed loop with MOCK agents

**Goal:** prove the orchestrator + state machine + registry work, with zero real
agents and zero git side effects.

Build:

1. **Registry store** — atomic load/save + schema validation ([02](02-data-model.md)).
2. **State machine** — the transition table as pure functions ([03](03-state-machine.md)).
   `next(item, policy) → transition`. No I/O. Fully unit-testable.
3. **Orchestrator loop** — the tick loop ([01 §2.1](01-architecture.md)).
4. **MockAdapter** — canned `implement`/`review` results ([04 §6](04-agent-adapters.md)),
   including a scripted `BLOCKING`-then-`CLEAN` sequence.

**Deliverable / demo:** feed in one `PLANNED` item; watch it walk
`PLANNED → BUILDING → IN_REVIEW → FIXING → RE_REVIEW → READY_FOR_HUMAN_MERGE`
purely from mock results, with the registry file updating at each step. This is
the [walkthrough](05-workflow-walkthrough.md) running against mocks.

**Why first:** if this is solid, every later phase is just "make a mock real."
All the *logic* risk is retired here, cheaply and deterministically.

---

## Phase 2 — Real git + one real agent (implementer only)

**Goal:** make the work physically happen on disk, reviewed by mock.

Build:

5. **Worktree manager** — create/teardown worktrees + branches ([01 §2.3](01-architecture.md)).
6. **Git/gh service** — commit, push, `gh pr create`, read PR number ([01 §2.5](01-architecture.md)).
7. **One real implementer adapter — `deepseek` via a generic `openai-compatible`
   adapter** (NOT Claude). A raw-LLM implementer needs a small tool-calling loop
   (read/write file, run command) around the API ([04 §3](04-agent-adapters.md),
   [08-providers.md](08-providers.md)). DeepSeek is the dev default: cheap, easy
   to obtain, OpenAI-compatible. Reviewer stays mock for now. Claude and other
   premium vendors become config-only additions later.
8. **Gates runner** — run the parent project's `npm test` and capture pass/fail.

**Deliverable / demo:** a real `PLANNED` item, implemented by DeepSeek, produces a
real branch, a real commit, a real PR — and parks at `READY_FOR_HUMAN_MERGE`
(mock review passes). You merge it by hand.

> Why the implementer (not the reviewer) is the hard part: editing the worktree
> requires the agentic tool loop. A reviewer is just one API call. So Phase 2
> spends its effort on that loop once, generically, so every OpenAI-compatible
> provider can implement.

---

## Phase 3 — Real cross-vendor review + the merge gate

**Goal:** close the loop with a *real, different-vendor* reviewer. This is the
moment Polly becomes *Polly*.

Build:

9. **A real reviewer adapter — a DIFFERENT-family raw LLM** (e.g. `openai`,
   `kimi`, or `glm`) via the same `openai-compatible` adapter. Review is just one
   call returning the normalized `verdict` enum ([04 §2](04-agent-adapters.md)),
   so this is the *easy* half — most of the machinery already exists from Phase 2.
10. **Role assignment** — enforce implementer ≠ reviewer, different family
    ([04 §4](04-agent-adapters.md)). Default dev pairing: `deepseek` implements ↔
    `openai`/`kimi`/`glm` reviews (two cheap, different families).
11. **Merge-gate policy** — `human` mode (park + stop) wired up; `auto` mode as a
    flag ([01 §2.6](01-architecture.md)).
12. **Retry/escalation** — `maxReviewRounds` cap → `BLOCKED` ([03 §4](03-state-machine.md)).

**Deliverable / demo:** the full [walkthrough](05-workflow-walkthrough.md) with
*real* agents, all cheap: DeepSeek implements, a different-family model finds a
real issue, DeepSeek fixes, the reviewer approves, you merge. End to end, mostly
unattended. (Claude/Codex/etc. drop in later as config-only vendors.)

---

## Phase 4 — Parallelism + waves

**Goal:** make it a *production line*, not a single-file queue.

Build:

13. **Concurrency** — advance N items at once with a cap (`policy.concurrency`);
    a worktree per item makes this safe ([01 §2.1](01-architecture.md)).
14. **Waves** — batch items, track wave progress, launch/report a wave
    ([02 §4](02-data-model.md)).
15. **A planner entry point** — accept a backlog (a list of specs) and seed
    items, optionally tagging waves.

**Deliverable / demo:** seed 5 items; watch several build/review concurrently;
report "wave1: 3/5 merged, 1 in review, 1 blocked".

---

## Phase 5 — Operability (optional but high-value)

**Goal:** make it pleasant to run unattended and to catch up on in the morning.

Build:

16. **A read-only dashboard / status command** — render the registry as a table
    (this is the *only* part of the original "canvas" worth rebuilding, and a CLI
    table is enough — [00 §5](00-overview.md)).
17. **Notes-driven catch-up** — `polly status` prints what's `READY`, what's
    `BLOCKED` (and the open question), what failed overnight.
18. **Token/cost accounting** — sum per-item agent spend (the original tracked
    free vs paid models carefully).

**Explicitly out of scope:** the infinite canvas UI and the contex peer-messaging
server. They're a monitoring/UX luxury; the line runs headless without them.

---

## Dependency order (what blocks what)

```
Phase 0 (stack)
   └─► Phase 1 (loop + mocks)         ← all logic risk retired here
          └─► Phase 2 (git + 1 agent)
                 └─► Phase 3 (cross-vendor review + gate)   ← "it's Polly now"
                        └─► Phase 4 (parallel + waves)
                               └─► Phase 5 (operability)
```

Do not skip ahead. Phase 1's mock-driven loop is the cheapest place to find every
logic bug; every later phase assumes it's rock-solid.

---

## Definition of done for the rebuild

Polly is "rebuilt" when:

- A backlog of specs can be seeded, and items run `PLANNED → MERGED` largely
  unattended;
- review is genuinely cross-vendor;
- the human's only routine action is approving merges;
- the registry remains a complete, resumable, auditable record;
- and the whole thing survives being killed and restarted at any point.

That is a *functional equivalent* of the original production line — which, per the
[main analysis](DERIVATION.md), is the ~75–78%-feasible part. The remaining
~22–25% (the polished canvas product and the accumulated operational know-how) is
deliberately not a goal: the canvas is unnecessary, and the know-how can only be
*earned by running the line*, not built.

---

## What you should now understand

1. Why build with mock agents before real ones? *(retires all logic risk
   cheaply and deterministically; later phases just make mocks real)*
2. Which phase is the point where "it becomes Polly"? *(Phase 3 — real
   cross-vendor review + merge gate)*
3. What is explicitly out of scope, and why? *(the canvas UI + contex server —
   monitoring luxury; the line runs headless)*

This is the last design doc. See also: [07-glossary.md](07-glossary.md) and
[DERIVATION.md](DERIVATION.md).
