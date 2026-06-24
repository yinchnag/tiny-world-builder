# 01 — Architecture

> This doc names the concrete components of Polly and shows how data flows
> between them. It is the map; later docs zoom into each region.

---

## 1. The big picture

Polly is a single controller process (the **orchestrator loop**) plus a set of
**services** it calls. Everything is coordinated through **one state file** (the
registry) and isolated through **git worktrees**.

```
                         ┌───────────────────────────────────────────┐
                         │            ORCHESTRATOR LOOP                │
                         │  (the only long-running process)           │
                         │                                            │
   registry.json ◄──────►│  1. read registry                         │
   (source of truth)     │  2. for each item: what's its next step?  │
                         │  3. dispatch that step                     │
                         │  4. write result back to registry          │
                         └───┬───────────┬───────────┬───────────┬───┘
                             │           │           │           │
                  ┌──────────▼──┐ ┌──────▼─────┐ ┌───▼──────┐ ┌──▼───────────┐
                  │  WORKTREE   │ │   AGENT    │ │  GIT /   │ │ MERGE-GATE   │
                  │  MANAGER    │ │  ADAPTERS  │ │  gh CLI  │ │  POLICY      │
                  │ (isolation) │ │ (vendors)  │ │ (PRs)    │ │ (human/auto) │
                  └─────────────┘ └────────────┘ └──────────┘ └──────────────┘
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                    claude_code      codex        openclaude  (pluggable)
```

The key insight: **the orchestrator holds no state in memory that isn't also in
the registry.** Kill it mid-run, restart it, and it picks up exactly where it
left off by re-reading the file. (Design principle #1.)

---

## 2. The components

### 2.1 Orchestrator loop — *the controller*

The heart. A loop that, each tick:

1. Loads the registry.
2. For every active item, asks the **state machine** ([03](03-state-machine.md))
   "given this item's current status, what is the next action?"
3. Executes that action by calling the right service (spawn an implementer,
   request a review, open a PR, check the merge gate…).
4. Writes the new status back to the registry.

It is deliberately *dumb plumbing*. All the *intelligence* lives in (a) the state
machine rules and (b) the agents it calls. The loop just shuttles items between
states.

> Concurrency: the loop can advance many items at once (item `p1` can be in
> review while `p2` is still building). The simplest correct version processes
> items one at a time per tick; a parallel version dispatches independent items
> concurrently with a cap. Start sequential, add concurrency later
> ([roadmap](06-roadmap.md) Phase 3).

### 2.2 Registry store — *the memory*

A thin read/write layer over the registry file ([02](02-data-model.md)).
Responsibilities:

- Atomic load/save (never leave a half-written registry on crash).
- A simple locking discipline so two writers can't clobber each other.
- Schema validation on write (reject malformed state early).

Everything else in the system is stateless and talks *through* this store.

### 2.3 Worktree manager — *isolation*

Each item gets its own **git worktree** so multiple implementer agents can edit
files **in parallel without colliding**. This is exactly what the original did —
the registry is full of entries like:

```json
"worktree": ".worktrees/p9-wave-inline-edit",
"branch": "polly/p9-wave-inline-edit",
"base": "origin/main 2d90eef"
```

The manager:

- Creates a worktree on a fresh branch off a known base commit when an item
  starts building.
- Hands the agent that worktree's path as its working directory.
- Tears the worktree down (or archives it) when the item merges or is abandoned.

> Why worktrees and not clones? A worktree shares the object store with the main
> repo (cheap, fast) while giving each branch its own working directory. It is
> the standard primitive for "N branches checked out at once."

### 2.4 Agent adapters — *the workers*

A uniform interface over different vendor agents. Polly should not care
*whether* an item is implemented by Claude Code, Codex, or Cursor — it just says
"implement this spec in this worktree" and gets back a result. Each vendor gets
an **adapter** that knows how to invoke that vendor (SDK call or CLI subprocess),
pass it the task, and capture its output + the `conv_id` for traceability.

Full detail in [04-agent-adapters.md](04-agent-adapters.md). The important
architectural fact: **vendors are pluggable**, and the implementer/reviewer
assignment deliberately picks *two different* vendors per item.

### 2.5 Git / `gh` service — *the conveyor belt*

Wraps the git and GitHub operations Polly needs:

- commit / push the implementer's branch
- open a PR (`gh pr create`) and read its number back into the registry
- post review findings as PR comments (optional)
- merge (`gh pr merge`) when the gate opens

The registry's `pr` field and the `#NN` references in commit messages are the
output of this service.

### 2.6 Merge-gate policy — *quality control*

Decides when a clean, reviewed item is allowed to merge. Two modes:

- **Human gate (default):** Polly parks the item at `READY-FOR-HUMAN-MERGE` and
  stops. A human merges. This is what the original did — the registry's
  `overnight_status` literally says *"merge-gate is the bottleneck … Awaiting
  human: merge #50→#51→#52"*.
- **Auto-merge (opt-in):** a policy that merges automatically once review is
  clean and CI is green. Off by default (design principle #4).

---

## 3. Data flow: one item, one lap

Here is the path a single item takes through the components. (The *tutorial*
version with real values is [05-workflow-walkthrough.md](05-workflow-walkthrough.md);
this is the component-level view.)

```
1. SEED       human/planner adds item to registry         → Registry store
2. BUILD      loop sees PLANNED → creates worktree         → Worktree manager
              → dispatches implementer (vendor A)          → Agent adapter
              → agent edits files, commits, pushes         → Git/gh service
              → loop opens PR, records pr#                  → Registry store
3. REVIEW     loop sees IN-REVIEW → dispatches reviewer    → Agent adapter
              (vendor B) against the PR diff                  (different vendor!)
              → reviewer returns findings                  → Registry store
4. DECIDE     blocking findings?
                yes → status FIXING, back to step 2        → state machine
                no  → status READY-FOR-HUMAN-MERGE
5. GATE       loop checks merge policy                     → Merge-gate policy
                human gate → stop, wait
                auto       → gh pr merge
6. DONE       record merged_at, tear down worktree         → Worktree manager
```

Every arrow that produces a fact writes it back to the registry. That is what
makes the loop resumable.

---

## 4. Why this shape (and not something fancier)

- **One state file, not a database.** The whole pipeline's state is small (tens
  of items). A JSON file is auditable, diffable, and crash-safe with atomic
  writes. The original used exactly this. A DB is a later optimization, not a
  starting requirement.
- **Worktrees, not containers.** Isolation between parallel agents is a
  *filesystem* problem at this scale, and worktrees solve it natively. Containers
  add ops weight you don't need yet.
- **Adapters, not a single hardcoded vendor.** Cross-vendor review is the whole
  point ([00 §2](00-overview.md)); the adapter seam is non-negotiable.
- **A loop, not an event bus.** A poll-the-registry loop is trivial to reason
  about and resume. Event-driven architecture is premature here.

---

## 5. What you should now understand

1. Name the six components and what each is responsible for.
2. Why can the orchestrator be killed and restarted safely? *(stateless; all
   state is in the registry)*
3. Why does each item get its own worktree? *(parallel agents editing files
   without collisions)*

Next: [02-data-model.md](02-data-model.md) — the exact shape of the registry
that ties all of this together.
