# 02 — Data Model (the Registry)

> The registry is the single source of truth (design principle #1). If you
> understand this file, you understand Polly's entire state. This doc defines its
> schema, field by field, and grounds every field in the original
> [`.polly/registry.json`](../../.polly/registry.json).

---

## 1. What the registry is

A single JSON file that holds **the complete state of the production line**: every
item, what state it's in, who's working on it, and the history of what happened.
The orchestrator reads it at the start of every tick and writes it back after
every action. Nothing else is persistent.

> **Note on the original file.** The real `.polly/registry.json` is *messy* — it
> grew organically and mixes schema with free-text operator notes (e.g. a
> `"note"` explaining a merge-conflict recovery, or `"SPRITE_CROWD_MISTAKE"`
> describing a bug and the user's reaction). That messiness is itself a lesson:
> the registry doubles as an **operator logbook**. Our rebuilt schema below is
> the *cleaned-up, normalized* version — but we keep a free-text `notes` field on
> purpose, because that human-readable trail turned out to be valuable.

---

## 2. Top-level shape

```jsonc
{
  "version": 1,                  // schema version, for future migrations
  "vendors": ["claude_code", "codex", "openclaude", "cursor"],
  "policy": {
    "merge": "human",            // "human" | "auto"
    "maxReviewRounds": 3,        // give up / escalate after N fix→review loops
    "concurrency": 4             // max items building/reviewing at once
  },
  "waves": [ /* Wave objects, see §4 */ ],
  "items": [ /* Item objects, see §3 — the core */ ],
  "notes": [ /* free-text operator log entries, see §5 */ ]
}
```

The original kept items *inside* nested wave objects and used object keys
(`p6_done`, `p9_in_flight`) instead of a flat list. We **flatten to a list** so
the schema is uniform and queryable; the wave membership becomes a field on each
item (`item.wave`). See [DERIVATION.md](DERIVATION.md) for the before/after.

---

## 3. The Item object — the core of the model

An **item** is one unit of work. This is the most important object in Polly.

```jsonc
{
  // ---- identity ----
  "id": "p9",                                  // stable short id
  "wave": "wave2",                             // which wave it belongs to (or null)
  "title": "WAVE indicator → inline ADMIN control",
  "spec": "Make wave assignment an inline admin-only control; public sees label only.",

  // ---- git location (where the work lives) ----
  "branch": "polly/p9-wave-inline-edit",       // convention: polly/<id>-<slug>
  "worktree": ".worktrees/p9-wave-inline-edit",// isolated checkout, or null
  "base": "origin/main 2d90eef",               // commit this branch forked from
  "pr": 61,                                    // GitHub PR number, or null

  // ---- role assignment (who builds, who judges) ----
  "implementer": "claude_code",                // vendor that writes the code
  "reviewer": "codex",                         // DIFFERENT vendor that reviews

  // ---- agent traceability ----
  "convId": "conv_50d2f72e...",                // implementer conversation id
  "reviewConvId": "conv_c7b236...",            // reviewer conversation id

  // ---- lifecycle ----
  "status": "BUILDING",                        // see 03-state-machine.md
  "reviewRound": 0,                            // how many fix→review loops so far
  "createdAt": "2026-06-18T06:00:00Z",
  "mergedAt": null,

  // ---- the latest review result ----
  "review": {
    "verdict": "BLOCKING",                     // CLEAN | NON_BLOCKING | BLOCKING
    "findings": [
      { "severity": "blocking", "where": "scripts/x.js:24",
        "what": "widget renders 0 (n<0 should be n<=0)" }
    ],
    "round": 1
  },

  // ---- gates / verification ----
  "gates": { "check": true, "test": true, "i18n": true, "build": true },
  "caveats": [
    "prod accept-path unverifiable headlessly — confirm Identity login live"
  ]
}
```

### Field reference

| Field | Type | Meaning | Trace in original |
|-------|------|---------|-------------------|
| `id` | string | Stable short id (`p0`, `p9`, `w1`) | `"id": "p9"` |
| `wave` | string\|null | Wave membership | nested under `wave_launch_system` / `living_lobby` |
| `title` / `spec` | string | Human title + the instruction the agent gets | `"item": "..."` |
| `branch` | string | `polly/<id>-<slug>` — **this naming is in git** | `"branch": "polly/p9-wave-inline-edit"` |
| `worktree` | string\|null | Isolated checkout path | `"worktree": ".worktrees/p9-..."` |
| `base` | string | Fork point commit | `"base": "origin/main 2d90eef"` |
| `pr` | number\|null | GitHub PR number | `"pr": 61` |
| `implementer` | vendor | Who writes the code | `"implementer": "claude_code"` |
| `reviewer` | vendor | Who reviews — **different vendor** | `"reviewer_vendor": "codex"` |
| `convId` / `reviewConvId` | string | Agent conversation ids (resume/audit) | `"conv_id"`, `"review_conv"` |
| `status` | enum | Lifecycle state ([03](03-state-machine.md)) | `"status": "RE-REVIEW"` |
| `reviewRound` | number | Fix→review loop counter | implied by `review_r1`, `review_r2` |
| `review` | object | Latest review verdict + findings | `"review": "BLOCKING round 1: ..."` |
| `gates` | object | Static-check results (check/test/i18n/build) | `"gates": "green 144 tests"` |
| `caveats` | string[] | Known limitations to flag to the human | `"caveat": "prod accept-path..."` |

> **The two fields that define Polly's whole philosophy** are `implementer` and
> `reviewer`. The invariant the orchestrator must enforce:
> `item.implementer !== item.reviewer` (and ideally different model *families*).
> See [00 §2](00-overview.md).

---

## 4. The Wave object

A wave batches items toward a release/deadline.

```jsonc
{
  "id": "wave1",
  "label": "WAVE1",
  "goal": "make the in-world lobby feel alive for the Sunday launch",
  "deadline": "2026-06-21",
  "decisions": {                 // free-form launch decisions for this wave
    "bots": "LLM via free OpenRouter models",
    "ambient_crowd_default_on": true
  }
}
```

Items reference their wave via `item.wave`. The orchestrator can report "wave1:
8/10 items merged" by querying items where `wave === "wave1"`.

---

## 5. The notes (operator log)

A list of free-text, timestamped entries. **This is the part people skip and
then regret.** The original registry's most *useful* content for understanding
what really happened was its prose notes — recovery stories, mistakes, and
pending decisions. We keep it as a first-class array.

```jsonc
{
  "at": "2026-06-18T11:36:57Z",
  "kind": "mistake",            // info | decision | mistake | blocked
  "text": "#64 enabled the legacy 2.5D sprite crowd in the lobby — WRONG (project uses voxel avatars). User angry. Fix = p19 removes sprite crowd."
}
```

Why first-class:

- It records the **why** behind decisions that the structured fields can't hold.
- It captures **failures**, which are the highest-value training data for tuning
  the line later (see operational know-how discussion in the main analysis).
- It's how a human catches up on overnight runs in 30 seconds.

---

## 6. Derived views (computed, not stored)

These are *not* fields — the orchestrator computes them from `items` on demand:

- **Ready for merge:** `items.filter(i => i.status === "READY_FOR_HUMAN_MERGE")`
- **In flight:** `items.filter(i => i.status in {BUILDING, IN_REVIEW, FIXING, RE_REVIEW})`
- **Wave progress:** group items by `wave`, count `merged`.
- **Stuck items:** `reviewRound >= policy.maxReviewRounds` → needs escalation.

Keep computed things out of the stored file; recompute them. Storing them invites
the file and reality to drift apart.

---

## 7. Invariants the store must enforce

On every write, validate:

1. `item.implementer !== item.reviewer` (the core cross-vendor rule).
2. `item.branch` matches `polly/<id>-<slug>`.
3. `status` is a legal value, and the transition into it is legal
   ([03-state-machine.md](03-state-machine.md)).
4. If `status` is past `BUILDING`, `worktree` and `branch` are set.
5. If `status` is past `IN_REVIEW`, `pr` is set.

Rejecting bad writes early is how you keep the source of truth trustworthy.

---

## 8. What you should now understand

1. What is the Item object, and which two fields encode Polly's core philosophy?
   *(`implementer` and `reviewer` — must be different vendors)*
2. Why keep a free-text `notes` log when you have structured fields? *(captures
   the *why*, failures, and pending decisions; it's the operator's catch-up
   trail)*
3. Why are "ready for merge", "wave progress", etc. *computed* rather than
   *stored*? *(to prevent the file from drifting out of sync with reality)*

Next: [03-state-machine.md](03-state-machine.md) — the legal states an item's
`status` moves through, and what triggers each transition.
