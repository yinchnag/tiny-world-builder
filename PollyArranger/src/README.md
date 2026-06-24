# src/ — implementation layout

> This folder grows **phase by phase** (see [../docs/06-roadmap.md](../docs/06-roadmap.md)).
> Right now it holds only the entry-point stub. Each module below maps directly to
> a component in [../docs/01-architecture.md](../docs/01-architecture.md).

## Planned modules (created as phases land)

| File | Component | Lands in | Notes |
|------|-----------|----------|-------|
| `index.mjs` | CLI / entry point | Phase 0 (stub) → grows | wires everything together |
| `registry/store.mjs` | Registry store | Phase 1 | atomic load/save + validation ([docs/02](../docs/02-data-model.md)) |
| `registry/schema.mjs` | Registry schema/validation | Phase 1 | enforces invariants ([docs/02 §7](../docs/02-data-model.md)) |
| `state-machine.mjs` | State machine | Phase 1 | **pure functions, no I/O** — `next(item, policy)` ([docs/03](../docs/03-state-machine.md)) |
| `orchestrator.mjs` | Orchestrator loop | Phase 1 | the tick loop ([docs/01 §2.1](../docs/01-architecture.md)) |
| `adapters/mock.mjs` | MockAdapter | Phase 1 | canned results for testing ([docs/04 §6](../docs/04-agent-adapters.md)) |
| `adapters/claude-code.mjs` | Claude adapter | Phase 2 | via `@anthropic-ai/claude-agent-sdk` |
| `adapters/codex.mjs` | Codex adapter | Phase 3 | CLI subprocess |
| `worktree.mjs` | Worktree manager | Phase 2 | git worktree create/teardown ([docs/01 §2.3](../docs/01-architecture.md)) |
| `git.mjs` | Git / gh service | Phase 2 | commit/push/PR ([docs/01 §2.5](../docs/01-architecture.md)) |
| `gates.mjs` | Gates runner | Phase 2 | runs parent `npm test` |
| `merge-gate.mjs` | Merge-gate policy | Phase 3 | human/auto ([docs/01 §2.6](../docs/01-architecture.md)) |

## Design rule

Keep **pure logic** (`state-machine.mjs`, `schema.mjs`) free of I/O so it's
unit-testable with zero agents and zero git. Side effects live in the orchestrator
and the adapters/services. This is what lets the whole pipeline be tested against
`MockAdapter` (Phase 1) before any real model is involved.
