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
| `services/git.mjs` | **Real** worktree/git/gates (async + repo-locked) | ✅ Phase 2.1 + ③ | non-blocking `git`/`gh`; shared ops serialized via mutex for safe `--concurrency > 1` |
| `util/mutex.mjs` | Async repo mutex | ✅ post-roadmap ③ | `runExclusive` serializes shared-repo git ops |
| `util/env.mjs` | `.env` loader | ✅ Phase 2.2 | reads API keys from the gitignored `.env` |
| `adapters/openai-compatible.mjs` | **Real** DeepSeek/OpenAI/Qwen/… adapter | ✅ Phase 2.2 | tool-calling `implement` + `review`; live-verified ([docs/08](../docs/08-providers.md)) |
| `demo-deepseek.mjs` | Live DeepSeek demo | ✅ Phase 2.2 | `npm run demo:deepseek` — real model writes + commits code |
| `adapters/factory.mjs` | Real adapter map builder | ✅ Phase 3 | vendor names → openai-compatible adapters |
| `demo-pipeline.mjs` | Live cross-vendor pipeline | ✅ Phase 3 | `npm run demo:pipeline` — DeepSeek implements, Qwen reviews, real e2e |
| merge gate | Merge-gate policy | ✅ Phase 3 | human parks / `auto` merges; `localMergeStrategy` for offline ([docs/01 §2.6](../docs/01-architecture.md)) |
| `orchestrator.mjs` (concurrency) | Concurrent tick + WIP cap | ✅ Phase 4 | pool dispatch; only START while active < `concurrency` |
| `planner.mjs` | Backlog seeder | ✅ Phase 4 | `seedItems(reg, specs, {wave})` → PLANNED items |
| `report.mjs` | Wave/status reporter | ✅ Phase 4 | `waveProgress` / `formatReport` (computed, not stored) |
| `demo-waves.mjs` | Offline wave demo | ✅ Phase 4 | `npm run demo:waves` — 5 items, concurrency=2, wave report |
| `report.mjs` (costTotals) | Token cost totals | ✅ Phase 5 | sums per-item `cost` |
| `status.mjs` | Operability view | ✅ Phase 5 | item table + catch-up + waves + cost + notes |
| `cli-status.mjs` | `npm run status` | ✅ Phase 5 | renders a registry file's status |
| `cli.mjs` | **Turnkey CLI** | ✅ post-roadmap ⓠ | `npm run polly -- run --repo <p> --backlog <f>` / `--spec`; `status` |
| gate-blocking | red gate → FIXING/BLOCKED | ✅ post-roadmap ① | a failing gate never opens a PR (orchestrator + state-machine) |
| `transcripts.mjs` | Conversation persistence | ✅ post-roadmap ⑤ | save/load messages per convId → true fix-lap resume |
| harness adapters (`claude_code`/`codex`) | optional vendors | ⬜ later | config-only additions |

## Design rule

Keep **pure logic** (`state-machine.mjs`, `schema.mjs`) free of I/O so it's
unit-testable with zero agents and zero git. Side effects live in the orchestrator
and the adapters/services. This is what lets the whole pipeline be tested against
`MockAdapter` (Phase 1) before any real model is involved.
