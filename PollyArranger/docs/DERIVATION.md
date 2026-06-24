# DERIVATION — design choices ↔ repo traces

> This is the honesty document. Polly's source code is **not** in the repo. Every
> design decision in these docs is *inferred* from a concrete trace that *is* in
> the repo. This file maps each inference to its evidence, and — just as
> importantly — marks what we are **guessing**.
>
> Read this to know which parts of the design are *reconstructed fact* vs.
> *reasonable invention*.

---

## 1. Primary evidence sources (all in the repo)

| Source | What it is | What it reveals |
|--------|-----------|-----------------|
| [`.polly/registry.json`](../../.polly/registry.json) | Polly's live state file (untracked-then-recreated; survived in working tree) | The data model, the roles, the statuses, the waves, the failures |
| `git log` / branch names | 816 commits, May 10 – Jun 24 2026 | The workflow made physical: `polly/pN-*` branches, PR sequence, cadence |
| `Co-authored-by` trailers | commit metadata | Multiple vendors really collaborated (Claude, Codex/Cursor, OpenClaude) |
| [`.codex/config.toml`](../../.codex/config.toml) | Codex CLI config | Headless autonomous mode (`approval_policy="never"`, `danger-full-access`) |
| [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) | contex protocol doc | The peer-coordination API (out of scope, but confirms the canvas layer) |
| [`tools/ai-bots.mjs`](../../tools/ai-bots.mjs) | runtime bot runner | The "one function for the model call" adapter pattern; Node ESM style |

---

## 2. Decision → trace map

### The three-role pipeline (implementer / reviewer / human)
- **Trace:** registry items carry `"implementer": "claude_code"` **and**
  `"reviewer_vendor": "codex"` on essentially every item.
- **Trace:** `overnight_status` says *"merge-gate is the bottleneck … Awaiting
  human: merge #50→#51→#52"* → the human is the merge gate.
- **Confidence:** **High.** Directly stated, on every item.

### Cross-vendor (different family) review
- **Trace:** the `implementer`/`reviewer_vendor` pairs are consistently
  *different* (`claude_code`↔`codex`).
- **Trace:** `Co-authored-by` trailers for Claude, Cursor, OpenClaude
  (mimo-v2.5-pro) on real commits.
- **Confidence:** **High** that it happened. **Inferred** that the *reason* is
  "shared families share blind spots" — that's our rationale, sound but not
  stated in the repo.

### Item naming `polly/<id>-<slug>` and the `pN` ids
- **Trace:** branches `polly/p0-account-admin-auth`, `polly/p8-github-stars`,
  `polly/w1-coach-card`, … merged via PRs in `git log`.
- **Trace:** registry keys `p0`, `p1`, `p2`, `p6_done`, `p9_in_flight`, …
- **Confidence:** **High.** The convention is in git itself.

### Worktree-per-item isolation
- **Trace:** `"worktree": ".worktrees/p9-wave-inline-edit"`, `"base":
  "origin/main 2d90eef"` on in-flight items.
- **Confidence:** **High.**

### The status set / state machine
- **Trace (raw statuses):** `"BUILDING"`, `"IN-REVIEW"`, `"RE-REVIEW (fix round
  ...)"`, `"READY-FOR-HUMAN-MERGE"`, `"FIXING+ADDING-README-SCREENSHOTS"`,
  `"PLAN-APPROVED-Awaiting-wallet-fork"`, `merged: true`.
- **Our normalization:**
  | Raw in registry | Normalized state |
  |-----------------|------------------|
  | `BUILDING` | `BUILDING` |
  | `IN-REVIEW` | `IN_REVIEW` |
  | `RE-REVIEW (...)`, `FIX-ROUND-2 (...)` | `RE_REVIEW` |
  | `FIXING+ADDING-...` | `FIXING` |
  | `READY-FOR-HUMAN-MERGE` | `READY_FOR_HUMAN_MERGE` |
  | `merged: true` + `merged_at` | `MERGED` |
  | `PLAN-APPROVED-Awaiting-...`, `AWAITING-TOKENS-...` | `BLOCKED` |
  | (no direct example) | `PLANNED`, `ABANDONED` |
- **Confidence:** **Medium-High.** The states are real; the *clean enum + the
  exact transition table* is our normalization. `PLANNED` and `ABANDONED` are
  inferred as necessary bookends.

### Review verdict enum (CLEAN / NON_BLOCKING / BLOCKING)
- **Trace:** *"review: CLEAN (zero blocking/non-blocking)"*, *"BLOCKING round 1:
  (1)… (2)… (3)…"*, *"Non-blocking S1: …"*.
- **Confidence:** **High** for the three levels; the enum names are ours.

### Review-round cap / escalation
- **Trace:** items reach `review_r1`, `review_r2`, `FIX-ROUND-2`.
- **Inference:** a `maxReviewRounds` cap → escalate. **Not stated**; it's our
  safety rule (the original may have relied on a human noticing). **Confidence:
  Inferred / recommended.**

### `BLOCKED` ≠ `ABANDONED`
- **Trace:** *"OPEN_FORK: Option A cannot verify wallet-only users … Need user
  decision"*, status `PLAN-APPROVED-Awaiting-wallet-fork`.
- **Confidence:** **High** that "waiting on a human decision" is a distinct real
  state.

### The `notes` / operator-log field
- **Trace:** the registry is full of prose: the top-level `"note"` about
  merge-conflict recovery; `"SPRITE_CROWD_MISTAKE": {"what": "... User angry"}`;
  `"overnight_status": "IDLE. ..."`.
- **Confidence:** **High** that the registry doubles as a logbook. Promoting it
  to a structured `notes[]` array is our cleanup.

### Gates = the parent project's `npm test`
- **Trace:** *"gates green 144 tests"*, *"check+test(144)+i18n+build green"*; and
  the parent [package.json](../../package.json) `test` = `check && smoke &&
  test:unit`.
- **Confidence:** **High.**

### Node.js adapter pattern ("one function for the model call")
- **Trace:** [`tools/ai-bots.mjs`](../../tools/ai-bots.mjs): *"The model call
  lives in ONE function (think) so swapping provider/SDK is a one-spot change."*
- **Trace:** `@anthropic-ai/claude-agent-sdk` in [package.json](../../package.json).
- **Confidence:** **High** for the pattern; the *language choice* for
  PollyArranger is still open ([roadmap](06-roadmap.md) Phase 0).

### Waves
- **Trace:** `wave_launch_system`, `WAVE1`/`WAVE2`, `living_lobby` goal *"feel
  alive for WAVE1 Sunday 21 Jun"*, branch `polly/w1-*`/`w2-*`, commit
  *"announce the autonomous production line (Wave 2 build-up)"*.
- **Confidence:** **High** waves exist. Their exact object shape is our design.

---

## 3. What we are NOT able to derive (the honest gaps)

These are **inventions or omissions**, flagged so no one mistakes them for fact:

1. **The orchestrator loop's actual code/algorithm.** Never in the repo. Our
   tick-loop design is a *reasonable* reconstruction, not the original.
2. **The contex server and CodeSurf canvas.** Only the *client protocol* leaked
   ([CLAUDE.md](../../.claude/CLAUDE.md)). We deliberately don't rebuild them.
3. **Prompts.** The actual implementer/reviewer prompts — the heart of quality —
   are not in the repo. This is the "operational know-how" that can only be
   re-earned by running the line.
4. **Scheduling / concurrency specifics.** That items ran concurrently is visible
   (74 commits/day); the *exact* scheduler is not. Our concurrency model is a
   design choice.
5. **Exact role-assignment policy.** We see pairs but not the rule that *chose*
   them. Round-robin + different-family is our proposal.
6. **Token/cost accounting.** The registry mentions free vs paid models
   (OpenRouter `:free`, rate limits) but not the accounting logic.

---

## 4. How to use this document

When implementing a feature from the design docs, check it here first:

- **High confidence** → implement as written; it reflects what the original did.
- **Inferred / recommended** → implement, but treat as a design decision you're
  free to revise with evidence.
- **Gap (§3)** → you are inventing; expect to iterate, and expect this to be
  where the real work (and the real know-how) lives.

This honesty is the point of the whole PollyArranger exercise: we can rebuild the
*skeleton* with high fidelity because the traces are rich, but the *muscle*
(prompts, scheduling nuance, know-how) must be regrown by operating the line.
