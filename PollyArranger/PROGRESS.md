# PROGRESS — start here every session

> **This file is the cross-session memory of the PollyArranger build.**
> Claude's context is finite and resets between sessions. This project is built
> across MANY sessions. The rule that makes that work:
>
> 1. **First action of every session:** read this file, then skim `docs/` as needed.
> 2. **Do ONE phase (or one sub-step) per session** — never leave a feature half-built across a context boundary.
> 3. **Last action of every session:** update this file (move the checkbox, write the "next session starts here" note), make sure tests are green, and commit.
>
> See [AGENTS.md](AGENTS.md) for the full handoff protocol.

---

## Where we are right now

- **Current phase:** Phase 4 complete → **Phase 5 not started.**
- **Next session starts here:** Begin [Phase 5](docs/06-roadmap.md#phase-5--operability-optional-but-high-value) —
  operability: (1) a read-only **status command / dashboard** that renders the
  registry as a table (reuse `src/report.mjs`); (2) **notes-driven catch-up**
  (`polly status` prints what's READY, what's BLOCKED + the open question, what
  failed); (3) **token/cost accounting** per item (sum agent spend). This is the
  last roadmap phase. Also still open: the known gap that gates capture pass/fail
  but don't block — decide whether to close it here. Explicitly OUT of scope: the
  canvas UI and contex server.
- **Stack:** Node.js ESM (`.mjs`). Decided, consistent with the parent project.
- **What Phase 1 delivered (all in `src/`, 26 tests passing):** pure state
  machine, registry store (atomic+validated), schema/invariants, MockAdapter,
  mock services, orchestrator loop, runnable demo (`npm start`).

---

## Phase checklist

| Phase | What | Status | Session-sized? |
|-------|------|--------|----------------|
| Design | All `docs/` + example registry | ✅ done | (was several steps) |
| **0** | Decide stack; scaffold `package.json` + `src/` + continuity files | ✅ done | yes |
| **1** | Closed loop with MOCK agents (store, state machine, loop, MockAdapter) | ✅ done | (1 session) |
| **2.1** | Real git services (worktree/git/gates) behind the mock interface | ✅ done | (1 session) |
| **2.2** | DeepSeek implementer adapter (tool-calling loop) | ✅ done | (1 session) |
| **3** | Real cross-vendor reviewer + merge gate + retry/escalation | ✅ done | (1 session) |
| **4** | Parallelism + waves + planner entry point | ✅ done | (1 session) |
| **5** | Operability: status command / dashboard / cost accounting | ⬜ next | 1 session |

Full detail per phase: [docs/06-roadmap.md](docs/06-roadmap.md).

---

## How to verify the current state (run this when you arrive)

```bash
cd PollyArranger
npm test               # 45 tests (all offline): + concurrency/WIP cap, planner, report
npm start              # Phase 1 demo: one item PLANNED -> READY_FOR_HUMAN_MERGE (mocks)
npm run demo:waves     # OFFLINE: 5 items, concurrency=2, wave report (no network)
npm run demo:deepseek  # LIVE: real DeepSeek writes + commits code (needs .env, network)
npm run demo:pipeline  # LIVE: DeepSeek implements + Qwen reviews, full real pipeline
```

If anything above fails, FIX THAT before building new work. The contract is:
**every session begins on green and ends on green.**

---

## Decisions log (so we never re-litigate)

| Date | Decision | Why |
|------|----------|-----|
| 2026-06-24 | Rebuild only the **orchestrator** (Polly). Skip contex server + CodeSurf canvas. | Highest value/feasibility; canvas is monitoring luxury, runs headless. ([docs/00 §5](docs/00-overview.md)) |
| 2026-06-24 | **Node.js ESM** runtime. | Consistent with parent project; reuses `@anthropic-ai/claude-agent-sdk`; zero build. |
| 2026-06-24 | Docs/comments in **English** (technical terms stay English). | User preference. |
| 2026-06-24 | Registry = **single source of truth**; orchestrator is stateless/resumable. | Crash-safety + auditability. ([docs/01](docs/01-architecture.md)) |
| 2026-06-24 | Build with **mock agents first** (Phase 1) before any real model call. | Retire all logic risk cheaply + deterministically. |
| 2026-06-24 | **Multi-vendor** via one generic `openai-compatible` adapter (DeepSeek/OpenAI/MiniMax/Kimi/Qwen/GLM); harnesses (Claude/Codex/Cursor) get their own adapters. | Polly's whole point is cross-vendor; most APIs are OpenAI-compatible, so one adapter covers many. ([docs/08](docs/08-providers.md)) |
| 2026-06-24 | **DeepSeek is the dev/debug default**, not Claude. | Claude keys are hard to get + expensive; DeepSeek is cheap, OpenAI-compatible, tool-calling. Claude/others become config-only additions later. |
| 2026-06-25 | Cross-vendor pair = **DeepSeek (implement) ↔ Qwen (review)**. | Two cheap, different families; both keys verified working. Qwen uses the DashScope **mainland** endpoint (`dashscope.aliyuncs.com/compatible-mode/v1`); the intl endpoint 401s this key. |

---

## Open questions (need a human/decision before they block work)

- _(none yet — Phase 1 has no external dependencies; it's pure logic + mocks.)_

When a phase surfaces a question that blocks progress, record it here AND (once
the orchestrator exists) as a `BLOCKED` item in the registry.

---

## Session log (newest first — append one entry per session)

### 2026-06-25 — Session 7 (Phase 4: concurrency + waves + planner)
- `src/orchestrator.mjs` — tick now dispatches all ready items through a
  concurrency pool (`mapPool`) with a **WIP cap**: only START new items while
  active < `policy.concurrency`. Items already in flight always advance. Refactor
  is behavior-preserving (prior 35 tests still green).
- `src/planner.mjs` — `seedItems(reg, specs, {wave})` appends PLANNED items with
  sequential ids; `newPlannedItem` helper.
- `src/report.mjs` — `statusCounts` / `waveProgress` / `formatReport` (computed,
  never stored).
- `test/{concurrency,planner,report}.test.mjs` — **45 tests passing**, all
  offline. Concurrency test asserts WIP never exceeds the cap.
- `src/demo-waves.mjs` + `npm run demo:waves` — offline: 5 items, concurrency=2,
  auto-merge; visibly caps WIP at 2, one item runs a fix loop, ends
  "wave1: 5/5 merged".
- **Handoff:** Phase 4 done. Next = Phase 5 (operability: status/dashboard,
  notes-driven catch-up, cost accounting) — the last roadmap phase. `report.mjs`
  is the foundation for the status command. Known gap still open: gates capture
  pass/fail but don't block.

### 2026-06-25 — Session 6 (Phase 3: real cross-vendor pipeline)
- Added Qwen as the reviewer vendor (key in `.env`; verified on DashScope
  mainland endpoint — intl 401s this key). DeepSeek↔Qwen = different families.
- `src/adapters/factory.mjs` — `createRealAdapters({vendors, repoPath})` builds the
  openai-compatible adapter map.
- `src/services/git.mjs` — `merge` is now injectable (`mergePullRequest`); added
  `localMergeStrategy` (offline merge into baseRef) so auto-merge works without
  GitHub.
- `test/pipeline-real-git.test.mjs` — offline e2e: orchestrator + REAL git +
  auto-merge drives one item PLANNED→MERGED, landing a real file on `main`
  (implementer = inline file-writer, reviewer = mock). **35 tests passing.**
- `src/demo-pipeline.mjs` + `npm run demo:pipeline` — **LIVE-VERIFIED**: real
  DeepSeek implemented `isEven()` + committed + pushed; real Qwen reviewed the
  diff → CLEAN; parked at READY_FOR_HUMAN_MERGE. First real cross-vendor run.
- **Handoff:** Phase 3 done — the core production line works end to end with real
  models. Next = Phase 4 (concurrency + waves + a planner/backlog entry point).
  Known gap still open: gates capture pass/fail but don't block.

### 2026-06-25 — Session 5 (Phase 2.2: DeepSeek implementer adapter)
- `src/adapters/openai-compatible.mjs` — generic adapter for any OpenAI-compatible
  API (PROVIDERS: deepseek/openai/kimi/glm/openrouter). `implement()` runs a
  tool-calling loop (list_files/read_file/write_file/run_command/finish), all
  path-scoped to the worktree (escape attempts refused), then commits the diff;
  `review()` is a single call returning the normalized verdict via a
  `submit_review` tool. `fetchImpl` injectable → unit-tested with no network.
- `src/util/env.mjs` — minimal `.env` loader (no dep).
- `src/demo-deepseek.mjs` + `npm run demo:deepseek` — **LIVE-VERIFIED**: real
  DeepSeek wrote a working `greet()` module + README and committed it (commit
  bb2a1d9 in a throwaway repo). First real model writing real code through Polly.
- **34 tests passing** (all offline; the 4 new adapter tests use a fake fetch).
- **Handoff:** Phase 2 done. Next = Phase 3 (real cross-vendor review + merge
  gate + a full real end-to-end orchestrator run). `review()` already exists, so
  Phase 3 is mostly wiring. May want a 2nd provider key for true cross-vendor.

### 2026-06-25 — Session 4 (Phase 2.1: real git services)
- `src/services/git.mjs` — REAL `worktree`/`git`/`gates` behind the mock
  interface (orchestrator unchanged): `git worktree add/remove`, `commit`,
  `push`, `openPR` (push + `gh pr create`, injectable), `gates.run` (captures
  pass/fail). git/gh via execFileSync (no shell); gates via shell (Windows
  `npm.cmd`).
- `src/util/slug.mjs` — shared branch/slug helpers; `services/mock.mjs` refactored
  to use it (re-exports `slugify` for compatibility).
- `test/git-services.test.mjs` — runs against a throwaway local repo + bare
  remote, NO GitHub/network; verifies create/commit/push(→remote)/gates/teardown.
  (Found + handled `safe.bareRepository=explicit`: verify via `ls-remote`.)
- **30 tests passing.** DeepSeek key stored in gitignored `.env` for 2.2.
- Known gap (intentional): gates capture pass/fail but don't yet BLOCK the
  pipeline (orchestrator transitions frozen for Phase 2) — refine later.
- **Handoff:** next = Phase 2.2, the DeepSeek tool-calling implementer adapter.

### 2026-06-24 — Session 3 (design: multi-vendor + DeepSeek-first)
- Wrote the multi-vendor plan into the design docs:
  - New [docs/08-providers.md](docs/08-providers.md): provider table, config shape,
    add-a-provider checklist, DeepSeek-first posture.
  - [docs/04](docs/04-agent-adapters.md): added the harness-vs-raw-API distinction,
    the one-generic-`openai-compatible`-adapter approach, and the DeepSeek-first
    decision; extended the §3 vendor table.
  - [docs/06](docs/06-roadmap.md): Phase 2 implementer is now **DeepSeek via
    `openai-compatible`** (not Claude SDK); Phase 3 reviewer is a different-family
    raw LLM. Both cheap.
  - Glossary + README index updated.
- Code: extended `DEFAULT_FAMILIES` in `src/state-machine.mjs` with
  deepseek/openai/minimax/kimi/qwen/glm (additive — no behavior change).
- Tests still green (no logic changed). **Handoff unchanged in spirit:** next
  session = Phase 2, but the first real adapter is DeepSeek, and you'll write
  `adapters/openai-compatible.mjs` (tool loop) + real `services/{worktree,git,gates}.mjs`.

### 2026-06-24 — Session 2 (Phase 1: closed loop with mock agents)
- Built the full closed loop, all pure-logic + mocks, no real models/git:
  - `src/state-machine.mjs` — pure `nextAction` / `applyResult` / `assignRoles`
    (all decision logic; the round cap → BLOCKED escalation lives here).
  - `src/registry/schema.mjs` — invariants (incl. implementer≠reviewer) + validation.
  - `src/registry/store.mjs` — atomic, validated load/save; `createEmptyRegistry`.
  - `src/adapters/mock.mjs` — canned `implement`/`review`; `reviewPlan` drives the fix loop.
  - `src/services/mock.mjs` — mock worktree/git/gates (Phase 2 swaps real ones in here).
  - `src/orchestrator.mjs` — the tick loop (only I/O layer); `tick` / `run`.
  - `src/index.mjs` — `npm start` demo; writes to `.run/` (gitignored).
- **26 tests passing** (`npm test`): unit (state machine, schema, store) +
  integration (PLANNED→READY via BLOCKING-then-CLEAN, auto-merge→MERGED,
  failing implementer→ABANDONED, persistent blocking→BLOCKED at cap).
- **Handoff:** next session = Phase 2. The mock services/adapters define the
  exact interfaces the real ones must match — implement `worktree.create/teardown`,
  `git.openPR/push/merge`, `gates.run`, and a real `claude_code` implement adapter
  via `@anthropic-ai/claude-agent-sdk`. Do NOT change `orchestrator.mjs`. Keep
  the reviewer mocked until Phase 3.

### 2026-06-24 — Session 1 (design + Phase 0)
- Wrote the full design doc set (`docs/00`–`06`, `07-glossary`, `DERIVATION`).
- Wrote `examples/registry.example.json` (validated).
- Closed Phase 0: chose Node.js ESM; added `package.json`, `src/` skeleton,
  `PROGRESS.md`, `AGENTS.md`.
- **Handoff:** next session = Phase 1. Start from the registry store + state
  machine (pure functions, no I/O) so they're unit-testable first, then the loop,
  then MockAdapter. See [docs/06 Phase 1](docs/06-roadmap.md#phase-1--the-closed-loop-with-mock-agents)
  and the [walkthrough](docs/05-workflow-walkthrough.md) as the behavior spec.
