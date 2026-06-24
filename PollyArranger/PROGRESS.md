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

- **Current phase:** Phase 0 complete → **Phase 1 not started.**
- **Next session starts here:** Begin [Phase 1](docs/06-roadmap.md#phase-1--the-closed-loop-with-mock-agents) —
  build the closed loop with **mock** agents: registry store → state machine →
  orchestrator loop → MockAdapter. Target: drive one item `PLANNED → READY_FOR_HUMAN_MERGE`
  from canned mock results, with the registry file updating at each step.
- **Stack:** Node.js ESM (`.mjs`). Decided, consistent with the parent project.

---

## Phase checklist

| Phase | What | Status | Session-sized? |
|-------|------|--------|----------------|
| Design | All `docs/` + example registry | ✅ done | (was several steps) |
| **0** | Decide stack; scaffold `package.json` + `src/` + continuity files | ✅ done | yes |
| **1** | Closed loop with MOCK agents (store, state machine, loop, MockAdapter) | ⬜ not started | **1 session** |
| **2** | Real git + 1 real implementer adapter; worktree mgr; gh; gates | ⬜ | 1–2 sessions |
| **3** | Real cross-vendor reviewer + merge gate + retry/escalation | ⬜ | 1–2 sessions |
| **4** | Parallelism + waves + planner entry point | ⬜ | 1–2 sessions |
| **5** | Operability: status command / dashboard / cost accounting | ⬜ | 1 session |

Full detail per phase: [docs/06-roadmap.md](docs/06-roadmap.md).

---

## How to verify the current state (run this when you arrive)

```bash
cd PollyArranger
npm test          # currently: a placeholder that passes; real tests land in Phase 1
node -e "JSON.parse(require('fs').readFileSync('examples/registry.example.json','utf8'))"  # example registry parses
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

### 2026-06-24 — Session 1 (design + Phase 0)
- Wrote the full design doc set (`docs/00`–`06`, `07-glossary`, `DERIVATION`).
- Wrote `examples/registry.example.json` (validated).
- Closed Phase 0: chose Node.js ESM; added `package.json`, `src/` skeleton,
  `PROGRESS.md`, `AGENTS.md`.
- **Handoff:** next session = Phase 1. Start from the registry store + state
  machine (pure functions, no I/O) so they're unit-testable first, then the loop,
  then MockAdapter. See [docs/06 Phase 1](docs/06-roadmap.md#phase-1--the-closed-loop-with-mock-agents)
  and the [walkthrough](docs/05-workflow-walkthrough.md) as the behavior spec.
