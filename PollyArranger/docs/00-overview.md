# 00 — Overview

> **Read this first.** It explains *why* Polly exists and the single idea that
> the whole system is built around. Later docs assume you have this picture.

---

## 1. The problem Polly solves

A single coding agent (Claude Code, Codex, Cursor, …) is good at *one task at a
time, with a human watching*. That has two limits:

1. **Throughput.** One agent, one task. If you want 30 features shipped in a
   weekend, one agent + one human reviewing each step is the bottleneck.
2. **Trust.** An agent that writes code *and* judges its own code is its own
   reviewer. It tends to approve its own mistakes. You cannot safely let it run
   unattended, because nothing independent is checking it.

Polly is the machine that removes both limits. It is an **orchestrator**: a
controller process that drives *many* agents through a disciplined workflow so
that work is produced in parallel **and** independently checked before a human
ever looks at it.

The original project's own words for it (from the latest commit message):

> `news: announce the autonomous production line (Wave 2 build-up) (#73)`

"Autonomous production line" is the right mental model. Polly is the line; the
agents are the workers; git/PRs are the conveyor belt; the human is quality
control at the very end.

---

## 2. The core idea: separate *who builds* from *who judges*

This is the single most important concept. Everything else is plumbing.

```
        ┌─────────────┐        ┌──────────────┐        ┌─────────────┐
 item → │ IMPLEMENTER │  PR →  │   REVIEWER    │ ok →  │ HUMAN MERGE │ → shipped
        │ (vendor A)  │        │  (vendor B)   │        │   GATE      │
        └─────────────┘        └──────────────┘        └─────────────┘
              ▲                        │ findings
              └────────── fix ─────────┘
```

- The **implementer** writes the code for one item on its own branch.
- The **reviewer** is a *different vendor's* agent. It reviews the implementer's
  PR adversarially — it is *trying to find problems*, and it has no ego
  investment in the code because it didn't write it.
- If the reviewer finds blocking issues, the item loops back: the implementer
  fixes, the reviewer re-reviews. This repeats until the review is clean.
- Only then does the item reach the **human merge gate**.

We know the original did exactly this because the registry records it on every
item, e.g.:

```json
{ "implementer": "claude_code", "reviewer_vendor": "codex", "status": "RE-REVIEW" }
```

and git confirms it: commits carry `Co-authored-by` trailers for *multiple*
vendors (Claude, Codex/Cursor, OpenClaude). See [DERIVATION.md](DERIVATION.md).

> **Why different vendors?** A model reviewing its own family's output shares its
> blind spots. A Codex review of Claude's code (and vice-versa) catches a
> genuinely different class of bug. The cross-vendor split is what makes
> unattended operation trustworthy.

---

## 3. The two units of work: *items* and *waves*

Polly organizes work at two scales.

- An **item** (the registry calls them `p0`, `p1`, `p2`, …) is one
  self-contained piece of work: "account-based admin auth", "WAVE1 countdown",
  "GitHub stars badge". One item → one branch (`polly/p0-account-admin-auth`) →
  one PR → one trip through the state machine.

- A **wave** is a batch of items launched and shipped together toward a deadline
  ("Wave 1", "Wave 2"). Waves are how Polly groups a release. The registry
  tracks which wave an item belongs to and the launch system around it.

This two-level structure (item lifecycle inside wave batching) is visible
directly in the git branch names: `polly/p0-…`, `polly/p1-…`, `polly/w1-…`,
`polly/w2-…`.

---

## 4. The registry is the brain's memory

Polly itself is **stateless**. All of its knowledge — what items exist, what
state each is in, who's implementing, who's reviewing, what the last review
said, what's blocked on a human — lives in **one file**: the registry
(the original is [`.polly/registry.json`](../../.polly/registry.json)).

This matters enormously for a rebuild:

- The orchestrator can crash and restart; it just re-reads the registry and
  continues.
- A human can read the registry to see the entire state of the line at a glance.
- Everything is auditable after the fact: the original registry still contains
  the full record of waves 1–2, including **failures and arguments** (e.g. a
  note that one agent enabled the wrong avatar system and "User angry", with the
  follow-up item created to fix it).

We treat "the registry is the single source of truth" as design principle #1.
See [02-data-model.md](02-data-model.md) for its schema.

---

## 5. What Polly is *not*

To keep scope honest:

- **Polly is not the agents.** It does not contain a model. It *calls* existing
  agents (via SDK or CLI) and orchestrates them. See [04-agent-adapters.md](04-agent-adapters.md).
- **Polly is not the canvas.** The original had a visual "infinite canvas" UI
  (CodeSurf) and a peer-messaging server (contex). Those are a *monitoring/UX
  layer*. The production line runs perfectly headless without them, so they are
  out of scope for this rebuild (a simple read-only dashboard may come later).
- **Polly is not a CI system.** It uses git/PRs and can trigger CI, but its job
  is *deciding what each agent does next*, not running test pipelines.

---

## 6. What you should now understand

Before moving on, you should be able to answer:

1. What are the three roles in the pipeline, and why is the reviewer a
   *different* vendor? *(implementer / reviewer / human gate; different vendor =
   genuinely independent, adversarial review without shared blind spots)*
2. What is the difference between an *item* and a *wave*? *(item = one unit of
   work with its own branch/PR/lifecycle; wave = a batch of items shipped
   together toward a deadline)*
3. Where does Polly keep its state, and why does that make it crash-safe?
   *(the registry file; the orchestrator is stateless and rebuilds from it)*

Next: [01-architecture.md](01-architecture.md) — the concrete components that
implement this idea.
