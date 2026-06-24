# 05 — Workflow Walkthrough (one item, end to end)

> The previous docs defined the parts. This one runs them. We follow a single
> item from "someone has an idea" to "merged to main", showing the registry
> after every step. This is the tutorial that ties everything together.

The example is modeled on a *real* item from the original registry: **p8 — the
GitHub stars badge** (README stars badge + star-history chart + a live-fetch
home pill). We pick it because the original record shows it going through a
*blocking* review and a fix lap — the interesting path, not the happy path.

---

## Step 0 — Seed: the item is born

A human (or a planner agent) adds the item to the registry as `PLANNED`.

```jsonc
// registry.items[]
{
  "id": "p8",
  "wave": "wave1",
  "title": "GitHub stars badge + star-history + live home pill",
  "spec": "Add a stars badge to README, a Star History chart, and a home-page stars pill that live-fetches the GitHub star count with caching + a graceful fallback.",
  "branch": null, "worktree": null, "base": null, "pr": null,
  "implementer": null, "reviewer": null,
  "status": "PLANNED", "reviewRound": 0
}
```

Nothing else is set yet. The orchestrator will fill the rest in.

---

## Step 1 — Assign roles + create isolation

The loop sees a `PLANNED` item and a free concurrency slot. It:

1. Runs `assignRoles` ([04 §4](04-agent-adapters.md)) → implementer
   `claude_code`, reviewer `codex` (different family ✓).
2. Asks the worktree manager to create the branch + worktree off current main.

```jsonc
{
  "id": "p8",
  "branch": "polly/p8-github-stars",            // ← convention applied
  "worktree": ".worktrees/p8-github-stars",     // ← isolated checkout
  "base": "origin/main bb84f72",                // ← fork point recorded
  "implementer": "claude_code",
  "reviewer": "codex",
  "status": "BUILDING"                          // ← PLANNED → BUILDING
}
```

> This matches the original exactly: branch `polly/p8-github-stars`, implementer
> `claude_code`, reviewer `codex`.

---

## Step 2 — Implement

The loop dispatches the implementer adapter:

```
claudeAdapter.implement({
  spec: "Add a stars badge to README, …",
  worktreePath: ".worktrees/p8-github-stars",
  base: "origin/main bb84f72"
})
```

The agent edits files in the worktree, commits. It returns:

```jsonc
AgentResult {
  ok: true,
  convId: "conv_p8_impl_001",
  summary: "Added README badge + star-history chart + home stars pill with fetch+cache+fallback",
  commits: ["a1b2c3d"]
}
```

The loop records the conv id and runs the **gates** (static checks —
`npm test` style: check/smoke/build). They pass. It pushes the branch and opens
a PR:

```jsonc
{
  "id": "p8",
  "convId": "conv_p8_impl_001",
  "pr": 56,                              // ← gh pr create returned #56
  "gates": { "check": true, "test": true, "build": true },
  "status": "IN_REVIEW"                  // ← BUILDING → IN_REVIEW
}
```

---

## Step 3 — Review (the cross-vendor check)

The loop dispatches the **reviewer** — a *different* vendor (`codex`):

```
codexAdapter.review({
  prNumber: 56,
  spec: "Add a stars badge to README, …",
  worktreePath: ".worktrees/p8-github-stars"
})
```

Codex reviews Claude's code adversarially and returns a **BLOCKING** verdict —
exactly what the original recorded:

```jsonc
ReviewResult {
  convId: "conv_p8_rev_001",
  verdict: "BLOCKING",
  findings: [
    { severity: "blocking", where: "scripts/github-stars.js:24",
      what: "widget renders 0 — `n<0` should be `n<=0`" },
    { severity: "blocking", where: "scripts/github-stars.js:46",
      what: "accepts+caches a 0 count" },
    { severity: "nit", where: "scripts/github-stars.js:9",
      what: "non-ASCII em dash" }
  ]
}
```

The state machine sees `BLOCKING` → transition to `FIXING`, increment the round:

```jsonc
{
  "id": "p8",
  "reviewConvId": "conv_p8_rev_001",
  "review": { "verdict": "BLOCKING", "round": 1, "findings": [ /* …3 above… */ ] },
  "reviewRound": 1,
  "status": "FIXING"                     // ← IN_REVIEW → FIXING
}
```

> This is the moment cross-vendor review pays off: Claude wrote a real off-by-one
> (`n<0` vs `n<=0`) and would likely have approved its own code. Codex, with no
> stake in it, caught it. *(Original note: "BLOCKING round 1: (1) widget renders 0
> (n<0 should be n<=0) … (2) accepts+caches 0 … (3) non-ASCII em dash.")*

---

## Step 4 — Fix (same implementer, resumed)

The loop dispatches the **same** implementer (`claude_code`), **resuming its
conversation** (`resumeConvId`) and handing it the findings as the new task:

```
claudeAdapter.implement({
  spec: "Fix review findings: (1) n<0 → n<=0 at github-stars.js:24; (2) don't cache 0 at :46; (3) ASCII dash at :9",
  worktreePath: ".worktrees/p8-github-stars",
  resumeConvId: "conv_p8_impl_001"        // ← continuity: it remembers what it built
})
```

It pushes fixes → status advances:

```jsonc
{ "id": "p8", "status": "RE_REVIEW", "commits": ["a1b2c3d", "e4f5g6h"] }
```

---

## Step 5 — Re-review (sticky reviewer)

The **same** reviewer vendor (`codex`) checks the fixes ([03 §4](03-state-machine.md),
rule 2 — sticky reviewer). This time:

```jsonc
ReviewResult { verdict: "CLEAN", findings: [] }
```

`CLEAN` → park at the human gate:

```jsonc
{
  "id": "p8",
  "review": { "verdict": "CLEAN", "round": 2, "findings": [] },
  "reviewRound": 2,
  "status": "READY_FOR_HUMAN_MERGE"      // ← RE_REVIEW → READY
}
```

The orchestrator now **stops touching p8.** It's done its job; the ball is in a
human's court. (Default merge policy = `human`.)

---

## Step 6 — Human gate → merge

A human looks at the registry, sees `p8` is `READY_FOR_HUMAN_MERGE` with a clean
2-round review, and merges PR #56. The loop detects the merge and finalizes:

```jsonc
{
  "id": "p8",
  "status": "MERGED",                    // ← terminal success
  "mergedAt": "2026-06-18T09:00:00Z"
}
```

The worktree manager tears down `.worktrees/p8-github-stars`. A `notes` entry is
appended:

```jsonc
{ "at": "2026-06-18T09:00:00Z", "kind": "info",
  "text": "p8 merged (#56) after 1 blocking round (off-by-one in star count). Wave1." }
```

---

## The whole lap, at a glance

```
PLANNED ─assign+worktree─► BUILDING ─push+PR─► IN_REVIEW ─BLOCKING─► FIXING
                                                                       │
   MERGED ◄─human─ READY_FOR_HUMAN_MERGE ◄─CLEAN─ RE_REVIEW ◄─push────┘
   (#56)                                            (codex, round 2)
```

Implementer: `claude_code` throughout. Reviewer: `codex` throughout. One blocking
round. One human action (the merge). Everything else automatic.

---

## What this walkthrough demonstrates

- **The registry is enough.** At every step the full state was one JSON object.
  Kill the orchestrator anywhere above and it resumes from the file.
- **Cross-vendor review earns its keep.** The independent reviewer caught a real
  bug the author would have shipped.
- **The human did one thing:** merge a pre-vetted PR. That's the "production
  line": humans approve, they don't babysit.

---

## A note on the unhappy paths (so they're not a surprise)

The original registry records these too — Polly must handle them:

- **Convergence failure:** review still `BLOCKING` after `maxReviewRounds` →
  escalate (`BLOCKED`/`ABANDONED`), don't loop. ([03 §4](03-state-machine.md))
- **Wrong thing built:** an item shipped the *wrong* design (the "sprite crowd"
  incident — "User angry"). The fix is a *new* item that reverts/corrects, plus a
  `notes` entry. Polly doesn't prevent bad specs; it makes the correction
  traceable.
- **Blocked on a decision:** *"wallet-only users can't be email-verified — need
  user decision."* → `BLOCKED`, surfaced to the human, not retried blindly.

Next: [06-roadmap.md](06-roadmap.md) — the order to actually build this in.
