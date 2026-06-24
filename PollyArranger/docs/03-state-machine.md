# 03 — The Item State Machine

> Every item moves through a fixed set of states. The orchestrator loop is, at
> its core, just "look at each item's state and do the one thing that state
> calls for." This doc defines the states, the legal transitions, and the
> trigger for each. Get this right and the rest of Polly is plumbing.

The state names here are normalized versions of the free-text statuses found in
the original registry (`"BUILDING"`, `"IN-REVIEW"`, `"RE-REVIEW (fix round ...)"`,
`"READY-FOR-HUMAN-MERGE"`, `"FIXING+ADDING-..."`, `merged: true`). See
[DERIVATION.md](DERIVATION.md) for the raw→normalized mapping.

---

## 1. The states

| State | Meaning | Who acts next |
|-------|---------|---------------|
| `PLANNED` | Item exists in the registry, not started | orchestrator |
| `BUILDING` | Implementer agent is writing code in its worktree | implementer (vendor A) |
| `IN_REVIEW` | PR is open; reviewer agent is reviewing | reviewer (vendor B) |
| `FIXING` | Review found blocking issues; implementer is fixing | implementer (vendor A) |
| `RE_REVIEW` | Fixes pushed; reviewer is checking them | reviewer (vendor B) |
| `READY_FOR_HUMAN_MERGE` | Review clean; parked at the human gate | human |
| `MERGED` | Merged to main (terminal, success) | — |
| `BLOCKED` | Stuck on an external decision/dependency | human |
| `ABANDONED` | Dropped (terminal, failure) | — |

> `FIXING`/`RE_REVIEW` are really just `BUILDING`/`IN_REVIEW` on a second-or-later
> lap. We keep them as distinct names because the operator wants to *see* "this
> is a rework loop, round 2", and because the `reviewRound` counter advances
> here. Functionally the orchestrator treats them the same as the first lap.

---

## 2. The transition diagram

```
                    ┌─────────┐
                    │ PLANNED │
                    └────┬────┘
            create worktree + dispatch implementer
                         ▼
                   ┌──────────┐        push + open PR
                   │ BUILDING │ ───────────────────────┐
                   └────┬─────┘                         ▼
                        │ (agent fails / gives up) ┌───────────┐
                        ▼                          │ IN_REVIEW │
                  ┌───────────┐                    └─────┬─────┘
                  │ ABANDONED │              reviewer verdict?
                  └───────────┘             ┌──────────┼───────────┐
                        ▲              CLEAN /          │ BLOCKING  │ needs external
                        │             NON_BLOCKING      │           │ decision
        maxReviewRounds │                  ▼            ▼           ▼
        exceeded ───────┘     ┌────────────────────┐ ┌────────┐ ┌─────────┐
                              │ READY_FOR_HUMAN_    │ │ FIXING │ │ BLOCKED │
                              │ MERGE              │ └───┬────┘ └────┬────┘
                              └─────────┬──────────┘     │ push      │ unblocked
                        human merges    │                ▼           │
                                        ▼          ┌───────────┐     │
                                  ┌─────────┐      │ RE_REVIEW │◄────┘
                                  │ MERGED  │      └─────┬─────┘
                                  └─────────┘            │ verdict (same as IN_REVIEW)
                                                         └──► CLEAN→READY / BLOCKING→FIXING
```

---

## 3. Transitions, one by one

Each transition has: a **guard** (when it's allowed) and an **action** (what the
orchestrator does). This table *is* the orchestrator's decision logic.

| From → To | Guard (trigger) | Action |
|-----------|-----------------|--------|
| `PLANNED → BUILDING` | concurrency slot free | worktree manager creates `polly/<id>-<slug>` off `base`; dispatch implementer with `spec` |
| `BUILDING → IN_REVIEW` | implementer reports success + commits exist | run gates (check/test/build); push branch; `gh pr create`; record `pr` |
| `BUILDING → ABANDONED` | implementer hard-fails or returns nothing usable | tear down worktree; log a `notes` entry |
| `IN_REVIEW → READY_FOR_HUMAN_MERGE` | reviewer verdict `CLEAN` (or `NON_BLOCKING` only) | record review; stop (await human) |
| `IN_REVIEW → FIXING` | reviewer verdict `BLOCKING` | record findings; `reviewRound++`; dispatch implementer with the findings as the new task |
| `IN_REVIEW → BLOCKED` | reviewer/agent flags an external dependency or open question | record the open question in `notes`; await human |
| `FIXING → RE_REVIEW` | implementer pushed fixes | push; re-request review from the **same reviewer vendor** |
| `RE_REVIEW → READY_FOR_HUMAN_MERGE` | verdict `CLEAN` | same as IN_REVIEW→READY |
| `RE_REVIEW → FIXING` | verdict still `BLOCKING` **and** `reviewRound < maxReviewRounds` | another fix lap |
| `RE_REVIEW → ABANDONED` (or `BLOCKED`) | `reviewRound >= maxReviewRounds` | escalate to human — don't loop forever |
| `BLOCKED → RE_REVIEW`/`FIXING` | human resolves the open question | resume where it left off |
| `READY_FOR_HUMAN_MERGE → MERGED` | human approves (or auto-merge policy + green CI) | `gh pr merge`; record `mergedAt`; tear down worktree |

---

## 4. The three rules that keep it safe

1. **Never loop forever.** `RE_REVIEW → FIXING` is bounded by
   `policy.maxReviewRounds`. When exceeded, the item escalates to a human rather
   than burning tokens on an unconvergeable fix. (The original shows real items
   going to round 2–3; a cap is essential.)

2. **The reviewer vendor is sticky across rounds.** Once `codex` reviews `p9`,
   *the same vendor* does the re-reviews. Switching reviewers mid-item loses the
   context of "what I asked you to fix." (Implementer is sticky too.)

3. **`BLOCKED` is not `ABANDONED`.** Many original items stalled on a *human
   decision*, not a code failure — e.g. *"OPEN_FORK: wallet-only users can't be
   email-verified — need user decision."* That's `BLOCKED`: the work is fine, it's
   waiting on a person. Keep it distinct so the human can find exactly what needs
   their input.

---

## 5. How the loop uses this (pseudocode)

This is the entire orchestrator, conceptually:

```
on each tick:
  registry = store.load()
  for item in registry.items where item.status is non-terminal:
      transition = stateMachine.next(item, registry.policy)
      if transition is null:        # nothing to do (e.g. waiting on human)
          continue
      if transition needs a free concurrency slot and none is free:
          continue
      result = execute(transition.action, item)   # may call agent/git/worktree
      item = applyResult(item, transition, result)
      store.save(registry)          # persist after every state change
```

Notice: the loop never decides *what* to do — it asks the state machine. All the
business logic is the transition table in §3. That separation is what makes Polly
testable: you can unit-test `stateMachine.next(item)` with zero agents, zero git.

---

## 6. What you should now understand

1. What stops an item from looping fix→review forever? *(`maxReviewRounds`, then
   escalate to human)*
2. Why is `BLOCKED` separate from `ABANDONED`? *(`BLOCKED` = good work waiting on
   a human decision; `ABANDONED` = failed work)*
3. Why must the reviewer vendor stay the same across re-reviews? *(it holds the
   context of what it asked to be fixed)*

Next: [04-agent-adapters.md](04-agent-adapters.md) — how the orchestrator
actually invokes a vendor agent to perform `BUILDING` and `IN_REVIEW`.
