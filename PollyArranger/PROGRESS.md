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

- **Current phase:** Phase 5 complete → **ROADMAP COMPLETE.** 🎉
- **What "done" means (achieved):** a backlog of specs can be seeded and run
  largely unattended; review is genuinely cross-vendor (DeepSeek↔Qwen, verified);
  the human's only routine action is approving merges; the registry is a complete,
  resumable, auditable record; concurrency + waves work; `npm run status` gives an
  operability view; 50 tests pass offline. This is a functional equivalent of the
  original production line (the ~75–78%-feasible part — see docs/DERIVATION.md).
- **Post-roadmap enhancements (all ⓠ①②③④⑤ done):**
  - ✅ **ⓠ Turnkey CLI** — `npm run polly -- run --repo <path> --backlog <file>` (or `--spec`);
    `polly status`. Live-verified end-to-end (DeepSeek→Qwen→merge on a throwaway repo).
  - ✅ **① Red gate blocks the PR** — a failing gate routes the item to FIXING with the
    gate output (bounded by `maxGateRounds` → BLOCKED); no PR opens while gates are red.
  - ✅ **② Harness adapters** (`src/adapters/harness.mjs`): drive an installed
    `claude` / `codex` CLI as a subprocess — **passes NO key** (uses the CLI's own
    auth, so it works even when you can't get a key). Prompt via stdin; review via
    strict `POLLY_VERDICT`/`POLLY_FINDING` markers; claude uses native
    `--session-id`/`--resume` (⑤ for free) and `--output-format json` (cost). Wired
    into the factory. Offline-verified (fake runner + real-spawn fake CLI). **Real
    `claude -p`/`codex exec` must be verified per machine** (workspace-trust prompt,
    permission flags) — see docs/08-providers.md.
  - ✅ **③ Real-git concurrency lock** — the git service is now async (non-blocking)
    so `--concurrency > 1` delivers real parallelism; shared-repo ops (worktree
    add/remove, push, openPR, merge) serialize through a per-repo mutex
    (`src/util/mutex.mjs`); gates + per-worktree commits stay parallel. Live-verified
    with `--concurrency 2` (two items built + reviewed in parallel, both merged).
  - ✅ **④ Long-running daemon** (`src/daemon.mjs`, `polly daemon`): drains work,
    then polls for new items added to the registry (e.g. via `polly add`), error-
    tolerant, graceful Ctrl-C stop. `polly add` queues items into a (running)
    daemon's registry.
  - ✅ **⑤ Persist agent transcripts** per `convId` (`src/transcripts.mjs`): the
    implementer's full conversation is saved and re-loaded on a fix lap, so the
    model truly continues (not soft-resume). Default file store under
    `<repo>/.polly/transcripts`; `transcriptStore: null` disables.
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
| **5** | Operability: status command / dashboard / cost accounting | ✅ done | (1 session) |

**🎉 All roadmap phases complete.** See "Optional next directions" above for where to go beyond the plan.

Full detail per phase: [docs/06-roadmap.md](docs/06-roadmap.md).

---

## How to verify the current state (run this when you arrive)

```bash
cd PollyArranger
npm test               # 77 tests (all offline): + gate-block ①, CLI ⓠ, transcripts ⑤, mutex ③, daemon ④, harness ②
npm run polly          # CLI: run | daemon | add | status. e.g. `-- run --repo <p> --spec "..."`
                       #   daemon: `-- daemon --repo <p>` keeps running; feed it with `-- add --repo <p> --spec "..."`
npm start              # Phase 1 demo: one item PLANNED -> READY_FOR_HUMAN_MERGE (mocks)
npm run demo:waves     # OFFLINE: 5 items, concurrency=2, wave report (no network)
npm run status         # OFFLINE: operability view of the last demo:waves registry
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

### 2026-06-25 — Session 16 (USAGE.md + fully-local `--local-pr`)
- `USAGE.md`: step-by-step guide for running Polly on **another project folder**
  (PollyArranger is the tool; `--repo` points at your repo). Vendors, gates,
  merge modes, local-vs-real-PR, Mac/Windows codex, .gitignore (.polly/.worktrees),
  cost, troubleshooting, cheat sheet. Linked from README.
- Code: `--local-pr` is now **fully local** — added `noPush` to git.mjs so it
  needs NO remote (was still pushing to origin). CLI sets it with `--local-pr`.
  New test: orchestrator + real git + auto-merge on a repo with NO remote → MERGED.
  **78 tests, all offline.**

### 2026-06-25 — Session 15 (LIVE: Claude Code implements ↔ DeepSeek reviews)
- **First real harness run, verified end-to-end on this machine** (Claude Code
  2.1.185): `polly run --vendors claude_code,deepseek --local-pr --merge auto`
  drove a fizzbuzz task PLANNED→MERGED. Claude wrote correct code + committed;
  DeepSeek reviewed the diff → CLEAN; merged. 2 calls, 4144 tokens.
- Probe confirmed the claude preset is correct for this version: `claude -p
  --output-format json --permission-mode acceptEdits` runs headless (no trust
  hang), JSON has result/session_id/total_cost_usd/usage.{input,output}_tokens
  exactly as the preset expects (cost + ⑤ native resume work).
- So **`claude_code` harness is now live-verified** (was only unit-tested).
  `codex` still per-machine on the home Mac/Windows (codex not installed here).
- No code change needed — preset matched reality. Doc-only update.

### 2026-06-25 — Session 14 (harness: cross-platform tuning flags + codex checklist)
- harness.mjs: prompt delivery is now `promptVia: 'stdin' | 'arg'` (claude=stdin,
  codex=arg `exec <prompt>`), plus a `forceStdin` override (Windows quoting dodge).
- cli.mjs: new flags `--harness-command` / `--harness-shell` / `--harness-stdin`
  applied to harness vendors → zero-code tuning per machine.
- docs/08-providers.md: per-machine verification checklist for **macOS + Windows**
  codex (and claude). Mac codex usually works as-is; Windows codex = `--harness-shell
  --harness-stdin` (+ maybe `--harness-command codex.cmd`), pending whether `codex
  exec` reads stdin (if not, add a temp-file prompt mode).
- harness.test.mjs: arg-mode appends prompt; forceStdin flips to stdin. **77 tests, all offline.**
- User home has codex on BOTH Mac + Windows. Real codex still unverified by me (not
  installed here) — it's now a ~10-min checklist run, not a dev session.

### 2026-06-25 — Session 13 (post-roadmap: ② CLI-harness adapters — Claude Code / Codex)
- `src/adapters/harness.mjs` (`createHarnessAdapter` + `HARNESS_PRESETS`): drives an
  installed `claude`/`codex` CLI as a subprocess. **Passes NO API key** — uses the
  CLI's own auth (works when the company won't give you a key). Prompt via stdin
  (quote-safe); Polly commits the CLI's edits; review parsed from strict
  `POLLY_VERDICT`/`POLLY_FINDING` markers (default BLOCKING if unparseable). claude
  preset uses `-p --output-format json` (→ cost) + native `--session-id`/`--resume`
  (= ⑤ without our transcript store). `defaultRunner` is injectable.
- `src/adapters/factory.mjs`: routes API vendors → openai-compatible, harness
  vendors (claude_code/codex) → harness adapter; unknown → clear error.
- `test/harness.test.mjs`: implement→commit, no-change→ok:false, fix-lap→--resume,
  review marker parse, unparseable→BLOCKING, **real spawn via a fake CLI over stdin**,
  factory routing. **75 tests, all offline.**
- NOT run here: real `claude -p` (spends the user's quota + workspace-trust prompt
  is a per-machine unknown). User verifies on work machine (claude) + home (codex);
  tune command/shell/permission flags via factory `harness` overrides if needed.
- **All six post-roadmap enhancements (ⓠ①②③④⑤) are now done.** No work remains
  unless new requirements appear.

### 2026-06-25 — Session 12 (post-roadmap: ④ daemon + `polly add`)
- `src/daemon.mjs` (`createDaemon`): drain-then-poll loop over `orchestrator.tick`
  — keeps working while there's work, sleeps `intervalMs` when idle, picks up items
  added to the registry between polls, tolerates a throwing tick (onError), stops
  gracefully (`stop()` lets the current tick finish; wakes an idle sleep early).
- `src/cli.mjs`: extracted `buildContext` (shared by run/daemon); added `daemon`
  (Ctrl-C → graceful stop) and `add` (queue items into a registry, e.g. for a
  running daemon) commands; `registryPathFor` + `ensureRegistry` helpers.
- `test/daemon.test.mjs`: drains 3 items to MERGED + stops clean; picks up an item
  added mid-run; a throwing tick doesn't kill the loop. **68 tests, all offline.**
- Offline-verified `polly add` (creates/append registry, sequential ids, wave tag).
  Daemon processing is unit-verified; its wiring (buildContext) is the same live-
  verified path as `run`.
- **Handoff:** only ② harness adapters (claude_code/codex) remains opt-in.

### 2026-06-25 — Session 11 (post-roadmap: ③ real-git concurrency lock)
- `src/util/mutex.mjs`: tiny async mutex (`createMutex` → `runExclusive`).
- `src/services/git.mjs`: rewritten ASYNC (execFile/exec via promisify, non-blocking)
  so `--concurrency > 1` actually parallelizes. Shared-repo ops — worktree
  add/remove, push, openPR, merge (incl. localMergeStrategy's main-tree checkout) —
  run through a per-repo mutex; gates (long, per-worktree) and per-worktree commits
  stay parallel. defaultGh* + localMergeStrategy are now async.
- `src/orchestrator.mjs`: `await`s the now-async service calls (backward-compatible
  with sync mock services — await of a non-promise is a no-op).
- Updated test helpers (git-services, openai-compatible, transcripts) to await the
  async service; added `test/mutex.test.mjs` (serialization, no-wedge-on-failure).
  **65 tests, all offline.**
- **Live-verified `--concurrency 2`**: two items BUILDING in parallel, then both
  IN_REVIEW in parallel, both MERGED — no git corruption (11 calls, 8499 tokens).
- CLI `--concurrency` help updated (>1 now safe). **Handoff:** remaining opt-in:
  ② harness adapters, ④ daemon.

### 2026-06-25 — Session 10 (post-roadmap: ⑤ transcript persistence / true resume)
- `src/transcripts.mjs`: file + in-memory transcript stores (load/save messages by
  convId; atomic file writes).
- `openai-compatible.mjs`: on a fix lap (resumeConvId set) the implementer now
  reuses the SAME convId, LOADS the prior conversation, and appends the follow-up —
  so the model genuinely continues (remembers its earlier tool calls), not a soft
  re-read. Every lap saves the full transcript. Default file store under
  `<repo>/.polly/transcripts`; `transcriptStore: null` disables; injectable for tests.
- `test/transcripts.test.mjs`: store round-trip; resume lap re-sends the prior
  conversation (same convId, prior spec carried + follow-up appended); fresh start
  without resume. **62 tests, all offline.**
- Live resume demo skipped on purpose: forcing a real fix lap needs a non-deterministic
  BLOCKING review; the wiring is unit-verified and the live adapter path was proven earlier.
- **Handoff:** remaining opt-in: ② harness adapters, ③ git concurrency lock, ④ daemon.

### 2026-06-25 — Session 9 (post-roadmap: ⓠ turnkey CLI + ① red-gate-blocks)
- **ⓠ CLI** (`src/cli.mjs`, `npm run polly`): `run --repo <path> (--backlog <file>|--spec "...")`
  + `status`. Assembles seed→git services→real adapters→orchestrator→status.
  Flags: --vendors/--base/--remote/--gates/--concurrency/--merge/--wave/--registry/
  --local-pr/--env. `parseArgs`+`loadBacklog` unit-tested; examples/backlog.example.json.
  **Live-verified**: one command drove DeepSeek→Qwen→auto-merge on a throwaway repo
  (real tokens shown: 1926). Default concurrency=1 (no git lock yet — see ③).
- **① Red gate blocks the PR**: gates now run on EVERY implement lap (orchestrator);
  a `passed:false` gate routes the item to FIXING with the captured gate output as
  the fix instruction, bounded by `policy.maxGateRounds` → BLOCKED; **no PR opens
  while gates are red**. git.mjs gates.run captures failure output; schema relaxed
  (FIXING no longer requires a PR — a red gate reaches FIXING pre-PR). Mock gates
  lack `passed` → treated as pass → existing behavior unchanged.
- **59 tests passing, all offline** (+ gate-block.test.mjs, cli.test.mjs).
- **Handoff:** ② harness adapters, ③ git concurrency lock, ④ daemon, ⑤ transcript
  persistence remain opt-in. Nothing is "next" by default.

### 2026-06-25 — Session 8 (Phase 5: operability — ROADMAP COMPLETE)
- Token cost accounting: `openai-compatible.mjs` captures `usage` from each API
  response (across the implement tool loop + review); `applyResult` folds it into
  each item's `cost` via `mergeCost` (mock path → no cost field). `report.costTotals`
  sums it.
- `src/status.mjs` (`formatStatus`) + `src/cli-status.mjs` (`npm run status`):
  per-item table, catch-up (READY / BLOCKED+reason / ABANDONED), wave progress,
  cost totals, recent notes — read-only, computed from the registry.
- `test/cost-status.test.mjs` + adapter usage assertion. **50 tests, all offline.**
- Verified: `npm run demo:waves && npm run status` renders the line's state.
- **All 6 roadmap phases (0,1,2.1,2.2,3,4,5) are done.** Polly is a functional
  equivalent of the original production line. See PROGRESS top for optional
  next directions beyond the roadmap (gate-blocking, harness adapters, real-git
  concurrency lock, daemon, transcript persistence). No phase is "next" — future
  work is opt-in.

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
