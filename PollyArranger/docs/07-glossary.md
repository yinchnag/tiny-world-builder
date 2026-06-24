# 07 — Glossary

> Every term used across the PollyArranger docs, defined once. When a doc uses a
> capitalized term (Item, Wave, Reviewer…), it means the definition here.

| Term | Definition |
|------|------------|
| **Polly** | The orchestrator: the controller process that drives many agents through the implement→review→merge workflow. The "production line." |
| **PollyArranger** | This folder — our reconstruction of Polly from the traces left in the repo. |
| **Orchestrator loop** | The single long-running process. Each tick: read registry → ask the state machine what's next per item → execute → write back. ([01](01-architecture.md)) |
| **Registry** | The single JSON state file that holds the entire pipeline's state. Single source of truth. ([02](02-data-model.md)) Original: `.polly/registry.json`. |
| **Item** | One self-contained unit of work (`p0`, `p1`, …). One item → one branch → one PR → one trip through the state machine. ([02 §3](02-data-model.md)) |
| **Wave** | A batch of items launched and shipped together toward a deadline ("Wave 1/2"). ([02 §4](02-data-model.md)) |
| **Spec** | The instruction an item carries — what the implementer agent is told to build. |
| **Implementer** | The agent (vendor A) that writes the code for an item. ([00 §2](00-overview.md)) |
| **Reviewer** | The agent that reviews the implementer's PR. **Must be a different vendor/family.** ([00 §2](00-overview.md)) |
| **Cross-vendor review** | The core idea: implementer and reviewer are different model families, so the review is genuinely independent (no shared blind spots). |
| **Human merge gate** | The final checkpoint. Polly parks a clean item at `READY_FOR_HUMAN_MERGE`; a human merges. Default policy. ([01 §2.6](01-architecture.md)) |
| **Vendor** | An agent backend: `claude_code`, `codex`, `cursor`, `openclaude`. Pluggable via adapters. |
| **Agent adapter** | The uniform interface over one vendor (`implement` / `review`). Hides each vendor's real invocation mechanism. ([04](04-agent-adapters.md)) |
| **Verdict** | The normalized review outcome enum: `CLEAN` / `NON_BLOCKING` / `BLOCKING`. Drives the state machine branch. ([04 §2](04-agent-adapters.md)) |
| **Finding** | One issue from a review: `{ severity, where, what }`. |
| **State machine** | The fixed set of item states + legal transitions. The orchestrator's decision logic lives here. ([03](03-state-machine.md)) |
| **Status** | An item's current state: `PLANNED`, `BUILDING`, `IN_REVIEW`, `FIXING`, `RE_REVIEW`, `READY_FOR_HUMAN_MERGE`, `MERGED`, `BLOCKED`, `ABANDONED`. ([03 §1](03-state-machine.md)) |
| **Review round** | One fix→re-review loop. Counted by `reviewRound`; capped by `policy.maxReviewRounds`. ([03 §4](03-state-machine.md)) |
| **Worktree** | A git worktree — an isolated checkout of a branch sharing the main repo's object store. One per item, so agents edit in parallel without collisions. ([01 §2.3](01-architecture.md)) |
| **Base** | The commit an item's branch forked from (e.g. `origin/main bb84f72`). |
| **Gates** | Static checks run before review/merge (the parent project's `npm test`: check/smoke/build/i18n). |
| **convId / reviewConvId** | The agent conversation ids for the implementer and reviewer, stored for resume (fix laps) and audit. |
| **Notes** | The free-text operator log inside the registry: info/decision/mistake/blocked entries. The human-readable trail. ([02 §5](02-data-model.md)) |
| **Merge policy** | `human` (park + wait, default) or `auto` (merge on clean review + green CI). ([01 §2.6](01-architecture.md)) |
| **contex** | (Original, out of scope) The peer-messaging MCP server agents used to coordinate on the canvas. Not in the repo; not rebuilt. |
| **CodeSurf** | (Original, out of scope) The "infinite canvas" multi-agent workspace UI. A monitoring/UX layer; the line runs headless without it. |
| **MockAdapter** | A test double returning canned agent results, so the whole orchestrator can be tested with no real models or git. ([04 §6](04-agent-adapters.md)) |
