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

- **Current phase:** Phase 1 complete → **Phase 2 not started.**
- **Next session starts here:** Begin [Phase 2](docs/06-roadmap.md#phase-2--real-git--one-real-agent-implementer-only) —
  make the work physically happen on disk: real **worktree manager** + **git/gh
  service** + **gates runner** + **one real implementer adapter** (`claude_code`
  via `@anthropic-ai/claude-agent-sdk`). Reviewer stays mock for Phase 2. Swap
  these in behind the SAME interfaces the mocks already use
  (`src/services/mock.mjs`, `src/adapters/mock.mjs`) — the orchestrator must not
  change. Target: a real `PLANNED` item produces a real branch + commit + PR and
  parks at `READY_FOR_HUMAN_MERGE`.
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
| **2** | Real git + 1 real implementer adapter; worktree mgr; gh; gates | ⬜ | 1–2 sessions |
| **3** | Real cross-vendor reviewer + merge gate + retry/escalation | ⬜ | 1–2 sessions |
| **4** | Parallelism + waves + planner entry point | ⬜ | 1–2 sessions |
| **5** | Operability: status command / dashboard / cost accounting | ⬜ | 1 session |

Full detail per phase: [docs/06-roadmap.md](docs/06-roadmap.md).

---

## How to verify the current state (run this when you arrive)

```bash
cd PollyArranger
npm test          # 26 tests: state machine, schema, store, full orchestrator integration
npm start         # runs the Phase 1 demo: one item PLANNED -> READY_FOR_HUMAN_MERGE
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

---

## Open questions (need a human/decision before they block work)

- _(none yet — Phase 1 has no external dependencies; it's pure logic + mocks.)_

When a phase surfaces a question that blocks progress, record it here AND (once
the orchestrator exists) as a `BLOCKED` item in the registry.

---

## Session log (newest first — append one entry per session)

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
