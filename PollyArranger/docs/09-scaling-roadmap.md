# 09 — Scaling Roadmap (large, long-running projects)

> **Status: DESIGN ONLY — not built.** This is the plan for evolving Polly from
> an *independent-task engine* into something that can drive *large, long-running,
> interdependent* projects. It follows the same discipline as the original
> roadmap ([06](06-roadmap.md)): design first, then build one phase at a time,
> each phase ending green + committed + recorded in PROGRESS.md. No code is
> written until a phase is started.

---

## 1. Where we are, and the gap

Today Polly is excellent at one shape of work (see [00 §1](00-overview.md)):

> a backlog of **mostly-independent, well-specified** tasks → fan out → cross-vendor
> review → merge gate, run continuously via the daemon.

That covers a lot: bugfixes, small features, refactors, tests, docs across a
codebase. But a *large interdependent project* exposes five gaps (observed in
the live pong run + analysis):

| Gap | Symptom on a big project |
|-----|--------------------------|
| **G1 No task dependencies / merge ordering** | All items fork off the same base; B that needs A merged first has no way to wait. Concurrent items that touch the same code collide at merge. |
| **G2 No merge-conflict handling** | Two items editing the same file → the second merge conflicts; today that's not resolved gracefully. |
| **G3 No cost/capability routing** | One model implements everything; Opus on every task is expensive at scale, weak models on hard tasks fail. |
| **G4 No task decomposition (planning)** | Polly can't turn "build feature X" into a reviewable backlog — a human/planner must. |
| **G5 No persistent project memory** | Each task starts fresh from the worktree; architectural decisions and conventions aren't carried forward. |

**Honest framing:** even fully built, this makes Polly a *much stronger engine*,
not an autopilot. The human (or a planner layer) still owns strategy — what to
build, priorities, and triaging `BLOCKED` items. That matches how the original
Polly reached scale: an autonomous implement/review loop **plus** human/orchestrator
strategy ([DERIVATION §3](DERIVATION.md)).

---

## 2. Design principles for this era

Carry over from [00 §5](00-overview.md) / [01 §4](01-architecture.md), plus:

1. **Additive, not a rewrite.** The registry, state machine, orchestrator, and
   adapter contracts stay. Every capability is a new field + a new rule, so the
   line keeps working (and all current tests keep passing) at each step.
2. **The registry stays the single source of truth** — dependencies, routing,
   and memory pointers live there, so the system stays resumable + auditable.
3. **The human expresses intent; Polly enforces it.** We do *not* try to
   auto-detect which tasks conflict (hard, unreliable). The user declares
   dependencies; Polly sequences and guards them. Auto-help (planner, conflict
   resolution) comes later and is always overridable.
4. **Every phase is offline-testable** with mocks before any real-model cost,
   exactly like Phases 1–5.

---

## 3. The phases (build order)

Ordered so each unlocks the next and the riskiest-but-foundational comes first.

### S1 — Task dependencies + merge ordering  *(do first)*

> **Status: DONE.** `dependsOn` on items + explicit backlog ids; the orchestrator
> gates `PLANNED → BUILDING` via `depGate` (start only when all deps are MERGED;
> a BLOCKED dep → keep waiting; an ABANDONED/missing dep → cascade the dependent
> to BLOCKED). Cycles + unknown deps are rejected at seed time (`validateDependencies`).
> `status` shows a "WAITING on dependencies" section. Merge ordering falls out of
> start-gating + fork-off-latest-base (no separate scheduler). 91 tests, all offline.

**Problem:** G1. **The foundation for safe concurrency on a real codebase.**

**Design:**
- Add `dependsOn: string[]` to the item model (ids that must be **MERGED** first).
- **Gate `PLANNED → BUILDING`**: an item may only start once *all* its deps are
  `MERGED`. Because `worktree.create` already forks off the *current* base at
  START time, a dependent that starts after its dep merged automatically builds
  on top of it. So **merge ordering falls out of start-gating + fork-off-latest-base** —
  no separate "merge scheduler" needed.
- A dep that ends `ABANDONED`/`BLOCKED` ⇒ the dependent becomes `BLOCKED`
  ("dependency X failed").
- **Cycle detection** at seed time (reject a backlog with a dependency cycle).
- Report/`status`: show what's waiting on what.

**Delivers:** declare a dependency graph; independent items still run in parallel
(capped by concurrency), dependent items run in the right order on an up-to-date
base. This is what makes a multi-task run on a real shared codebase safe.

**Tests (offline):** start-gating (B waits for A); dep-failure cascades to
BLOCKED; cycle rejected; independent items still parallel.

**Honesty:** the user must *declare* deps. Tasks they wrongly mark independent can
still collide → that's S2.

### S2 — Merge-conflict handling

> **Status: DONE (option b).** Merge strategies now return a result instead of
> throwing: `{ok:true}` or `{ok:false, conflicts, reason}`. `localMergeStrategy`
> attempts the merge and, on conflict, **aborts to restore a clean base** and
> reports; `gh` merge failures are caught the same way. The orchestrator's MERGE
> keeps the worktree on conflict and the state machine routes the item to
> **BLOCKED** ("Merge conflict with <base> in: <files>") instead of crashing.
> 95 tests, all offline (incl. a real two-branch add/add conflict). The optional
> agent-resolve lap (option a) remains future work behind a flag.

**Problem:** G2 — even "independent" items can touch the same code.

**Design:**
- Before merging, **rebase/merge the item's branch onto the latest base** inside
  its worktree.
- Clean ⇒ proceed to merge as today.
- Conflict ⇒ either (a) **dispatch the implementer to resolve the conflict** (a
  new `RESOLVING` lap that hands the agent the conflict markers, bounded like
  fix laps), or (b) **`BLOCKED`** with a clear "merge conflict with <base>"
  message. Start with (b) (safe, simple); add (a) behind a flag.

**Delivers:** concurrent overlapping changes don't silently corrupt; they either
auto-resolve or surface for a human.

**Tests:** simulated conflicting branches → BLOCKED; (later) agent-resolve path.

### S3 — Cost / capability routing

**Problem:** G3 — control spend and match model to difficulty.

**Design:**
- A routing policy in the registry: map an item's **tags/size/path** to an
  implementer (and reviewer) vendor. e.g. default `deepseek` implements; items
  tagged `hard`/`architecture` escalate to `claude_code`; cheap models review.
- Optional **auto-escalation**: if an item hits `maxReviewRounds` with a cheap
  implementer, retry once with a stronger one before `BLOCKED`.
- Surface spend per wave/项目 in `status` (we already track tokens/cost).

**Delivers:** run the bulk cheaply, spend premium tokens only where needed.

**Tests:** routing picks the right vendor per tag; escalation on non-convergence.

### S4 — Planner (task decomposition)

**Problem:** G4 — turn a goal into a reviewable backlog.

**Design:**
- A `plan` command: an agent takes a **goal + repo context** and emits a
  structured backlog — `[{ title, spec, dependsOn, tags }]` — which feeds
  `seedItems`. Human reviews/edits the plan before it runs (a gate, like merge).
- Re-uses the adapter layer; output validated against a schema (like the
  reviewer's verdict).

**Delivers:** "here's the feature, plan it" → a dependency-ordered backlog you
approve, then Polly executes it.

**Tests:** planner output validates against the backlog schema; feeds the
pipeline end-to-end with mocks.

**Honesty:** decomposition quality is a prompt/know-how problem — expect
iteration. The human-approval gate keeps it safe.

### S5 — Project memory

**Problem:** G5 — carry architecture/conventions across tasks over time.

**Design:**
- A persistent `.polly/memory.md` (decisions, conventions, gotchas) injected as
  context into implement + review prompts.
- A lightweight **scribe** step on merge: append durable facts learned by a task
  (or maintain the repo's `CLAUDE.md`). Bounded + append-only; human-editable.

**Delivers:** later tasks respect earlier decisions; the project accrues memory
instead of every agent starting cold.

**Tests:** memory is loaded into prompts; scribe appends on merge (with mocks).

---

## 4. Dependency order

```
S1 (deps + merge ordering)        ← foundation; do first
   └─► S2 (conflict handling)     ← builds on S1's rebasing/merge path
S3 (routing)        ← independent; can land any time after S1
S4 (planner)        ← naturally emits S1 dependencies; do after S1
S5 (memory)         ← independent; highest "feel" value, lowest urgency
```

**Recommended sequence:** **S1 → S2 → S3 → S4 → S5.** S1 first because nothing
else is safe to run at scale without dependency/merge ordering. Each is its own
session (or two), gated by tests, exactly like Phases 1–5.

---

## 5. Registry/data-model changes (summary)

All additive (no breaking changes; existing items/tests unaffected):

```jsonc
// item additions
"dependsOn": ["p3", "p7"],     // S1 — must be MERGED before this starts
"tags": ["backend", "hard"],   // S3 — routing input
// new states (S2): RESOLVING (optional, agent conflict-resolution lap)

// policy additions
"routing": { /* tag/path → vendor map */ },   // S3
"autoEscalate": true,                          // S3
"memoryFile": ".polly/memory.md"               // S5
```

The state machine gains: a start-gate on deps (S1), a pre-merge rebase + optional
RESOLVING lap (S2). Everything else (review loop, gate-blocking, history, cost,
daemon) is unchanged.

---

## 6. What this still won't do (honesty)

Even with S1–S5, Polly is an **engine with a human/planner in the loop**, not a
"give it a goal, get a finished product" autopilot:

- The human approves plans (S4) and triages `BLOCKED` items.
- Decomposition and conflict-resolution quality depend on prompts/know-how that
  must be earned by running it ([DERIVATION §3](DERIVATION.md)).
- It orchestrates code tasks; it doesn't own product strategy, design taste, or
  release management.

That's the right scope: a trustworthy, auditable production line that a human
*directs* — which is exactly how the original reached large scale.

---

## 7. Next step

This document is the design. The next build session starts **S1** — and only S1 —
following the loop: write it + offline tests → green → update PROGRESS.md →
commit. Do not start coding from this doc until S1 is explicitly begun.
