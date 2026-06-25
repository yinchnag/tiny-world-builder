# src/ — implementation layout

> This folder grows **phase by phase** (see [../docs/06-roadmap.md](../docs/06-roadmap.md)).
> Right now it holds only the entry-point stub. Each module below maps directly to
> a component in [../docs/01-architecture.md](../docs/01-architecture.md).

## Modules (✅ = landed)

| File | Component | Status | Notes |
|------|-----------|--------|-------|
| `index.mjs` | CLI / demo entry point | ✅ Phase 1 | `npm start` drives one item through the lifecycle |
| `registry/store.mjs` | Registry store | ✅ Phase 1 | atomic load/save + validation ([docs/02](../docs/02-data-model.md)) |
| `registry/schema.mjs` | Registry schema/validation | ✅ Phase 1 | enforces invariants ([docs/02 §7](../docs/02-data-model.md)) |
| `state-machine.mjs` | State machine | ✅ Phase 1 | **pure functions, no I/O** — `nextAction` / `applyResult` ([docs/03](../docs/03-state-machine.md)) |
| `orchestrator.mjs` | Orchestrator loop | ✅ Phase 1 | the tick loop; only I/O layer ([docs/01 §2.1](../docs/01-architecture.md)) |
| `adapters/mock.mjs` | MockAdapter | ✅ Phase 1 | canned results for testing ([docs/04 §6](../docs/04-agent-adapters.md)) |
| `services/mock.mjs` | Mock worktree/git/gates | ✅ Phase 1 | Phase 2 replaces these behind the same interface |
| `util/slug.mjs` | Branch/slug helpers | ✅ Phase 2.1 | shared by mock + real services |
| `services/git.mjs` | **Real** worktree/git/gates | ✅ Phase 2.1 | `git` worktree + commit/push, PR via `gh`, gates run ([docs/01 §2.3/2.5](../docs/01-architecture.md)) |
| `adapters/openai-compatible.mjs` | DeepSeek/OpenAI/… adapter | ⬜ Phase 2.2 | tool-calling loop; DeepSeek is the dev default ([docs/08](../docs/08-providers.md)) |
| `adapters/codex.mjs` (or another raw LLM) | Reviewer adapter | ⬜ Phase 3 | different-family reviewer |
| `merge-gate.mjs` | Merge-gate policy | ⬜ Phase 3 | human/auto ([docs/01 §2.6](../docs/01-architecture.md)) |

## Design rule

Keep **pure logic** (`state-machine.mjs`, `schema.mjs`) free of I/O so it's
unit-testable with zero agents and zero git. Side effects live in the orchestrator
and the adapters/services. This is what lets the whole pipeline be tested against
`MockAdapter` (Phase 1) before any real model is involved.
