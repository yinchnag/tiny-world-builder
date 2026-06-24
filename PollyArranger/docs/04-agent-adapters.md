# 04 — Agent Adapters (the vendor seam)

> Polly's whole value proposition — cross-vendor implement-and-review — depends
> on being able to talk to *different* agent backends through *one* interface.
> This doc defines that interface, the adapter contract, and the rules for
> assigning vendors to roles.

---

## 1. Why an adapter layer at all

The orchestrator must be able to say, abstractly:

> "Agent, here is a task and a working directory. Go do it. Tell me what
> happened."

…without knowing whether "Agent" is Claude Code (via the
`@anthropic-ai/claude-agent-sdk` already in the parent project's
[package.json](../../package.json)), Codex (via its CLI, configured in
[.codex/config.toml](../../.codex/config.toml)), Cursor, or OpenClaude. Each of
those has a *different* invocation mechanism but should look *identical* to
Polly.

That uniform shape is the **Agent Adapter**. The original project proves all four
were in play — git commits carry `Co-authored-by` trailers for Claude (Opus
4.7/4.8), Cursor, and OpenClaude (mimo-v2.5-pro), and the registry assigns
`claude_code` / `codex` per item.

---

## 2. The adapter contract

Every vendor adapter implements the same two operations. (Language TBD — shown
here as pseudocode interfaces; see [roadmap](06-roadmap.md) Phase 0.)

```
interface AgentAdapter {
  vendor: string            // "claude_code" | "codex" | "cursor" | "openclaude"

  // IMPLEMENT: do the work described by `task` inside `worktreePath`.
  // Returns when the agent is done (or failed).
  implement(task: ImplementTask) -> AgentResult

  // REVIEW: review the diff/PR described by `task`. Does NOT edit code.
  // Returns a structured verdict.
  review(task: ReviewTask) -> ReviewResult
}
```

### Inputs

```
ImplementTask {
  spec: string            // the instruction (from item.spec, plus findings on a fix lap)
  worktreePath: string    // the isolated checkout to work in
  base: string            // base commit, for context
  resumeConvId?: string   // resume a prior conversation (fix laps reuse this)
}

ReviewTask {
  prNumber?: number       // the PR to review, or…
  diff: string            // …the raw diff, if reviewing pre-PR
  spec: string            // what the item was *supposed* to do
  worktreePath: string    // so the reviewer can read surrounding code
}
```

### Outputs

```
AgentResult {
  ok: boolean
  convId: string          // store on the item for resume + audit
  summary: string         // what it did, for the notes log
  commits: string[]       // sha(s) it produced (empty if it failed)
}

ReviewResult {
  convId: string
  verdict: "CLEAN" | "NON_BLOCKING" | "BLOCKING"
  findings: Finding[]     // [{ severity, where, what }]
}
```

The **`verdict` enum is the contract that drives the state machine**
([03 §3](03-state-machine.md)): `BLOCKING` → `FIXING`, otherwise →
`READY_FOR_HUMAN_MERGE`. Whatever the underlying model says in prose, the adapter
must normalize it into this enum. (The original reviewer outputs were exactly
this shape: *"CLEAN (ship it)"*, *"BLOCKING round 1: (1)… (2)…"*.)

---

## 3. How each adapter is implemented (sketch)

Each adapter is just a translator between Polly's contract and one vendor's
real invocation path.

| Vendor | How Polly invokes it | Notes |
|--------|----------------------|-------|
| `claude_code` | `@anthropic-ai/claude-agent-sdk` (already a project dep) — programmatic agent session with tools, working dir = worktree | First-class; the SDK gives structured turns + tool use |
| `codex` | Subprocess the Codex CLI; it's configured headless in `.codex/config.toml` (`approval_policy="never"`, `danger-full-access`) | CLI in, captured output out |
| `cursor` | Cursor agent CLI / API subprocess | Seen in `Co-authored-by: Cursor` |
| `openclaude` | OpenClaude harness subprocess | Seen in `Co-authored-by: OpenClaude (mimo-v2.5-pro)` |

> **Implementation tip.** Keep the model call in *one* function per adapter (the
> original's own `ai-bots.mjs` does exactly this: *"The model call lives in ONE
> function (think) so swapping provider/SDK is a one-spot change"*). That single
> choke point is where you handle retries, token accounting, and timeouts.

### Getting structured output

Reviewers must return the `verdict` enum, not prose. Two ways:

1. **Tool/function calling** (preferred when the SDK supports it): force the
   reviewer to call a `submit_review({verdict, findings})` tool. Validation
   happens at the tool boundary; the model retries on a malformed call.
2. **Prompt + parse** (fallback): instruct strict output, then parse. Less
   reliable; only for CLI vendors without tool-calling.

---

## 4. Vendor assignment rules

The orchestrator assigns vendors to roles when an item starts. Rules:

1. **Implementer ≠ Reviewer** (hard invariant — [02 §7](02-data-model.md)).
2. **Prefer different model *families*.** Claude-implements → Codex-reviews is
   stronger than Claude-implements → Claude-reviews, because shared-family models
   share blind spots ([00 §2](00-overview.md)).
3. **Stickiness.** Once assigned, both roles stay fixed for the life of the item
   across all fix/re-review laps ([03 §4](03-state-machine.md)).
4. **Capability routing (optional, later).** Some vendors are better at some
   work (e.g. one is stronger at CSS, another at backend). A simple routing table
   can pick the implementer by item tag. Start with round-robin; add routing when
   you have evidence.

A minimal assignment policy:

```
assignRoles(item, availableVendors):
    impl = pickLeastBusy(availableVendors)
    rev  = pickDifferentFamily(availableVendors, exclude=impl)
    return { implementer: impl, reviewer: rev }
```

---

## 5. Failure handling (per adapter)

Agents fail in messy ways. The adapter — not the orchestrator — owns the mess:

- **Timeout:** each call has a wall-clock cap; on timeout, return `ok:false`.
- **Crash / non-zero exit (CLI vendors):** capture stderr into the result
  summary; `ok:false`.
- **"Bridge-state" / session errors:** the original explicitly logged *"claude_code
  (after 2 codex bridge-state failures)"* — i.e. a vendor's session layer failed
  and the work was reassigned. Adapters should surface this clearly so the
  orchestrator can **reassign to another vendor** rather than abandon the item.
- **Empty/garbage output:** treat as failure, not success.

The orchestrator's only job on failure is to consult the state machine
(`BUILDING → ABANDONED`, or reassign and retry) — all the vendor-specific
knowledge stays behind the adapter seam.

---

## 6. Testability

Because the contract is small and pure-ish, you can write a **`MockAdapter`**
that returns canned `AgentResult` / `ReviewResult` values. With it you can test
the *entire* orchestrator + state machine **without any real model calls or
git** — drive an item from `PLANNED` all the way to `MERGED` deterministically.
This mock is the first thing to build ([roadmap](06-roadmap.md) Phase 1).

---

## 7. What you should now understand

1. What two operations does every adapter implement, and what does each return?
   *(`implement → AgentResult`, `review → ReviewResult` with a normalized
   `verdict` enum)*
2. Why normalize the reviewer's prose into a `verdict` enum? *(the enum is the
   contract that drives the state machine's branch)*
3. Why should implementer and reviewer be different model *families*, not just
   different sessions? *(shared families share blind spots; cross-family review
   is genuinely independent)*

Next: [05-workflow-walkthrough.md](05-workflow-walkthrough.md) — all the pieces
together, following one real item from idea to merge.
