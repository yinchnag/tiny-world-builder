# PollyArranger

> A reconstruction of **Polly** — the multi-agent orchestrator ("the factory
> production line") that built [tiny-world-builder](../README.md).

Polly is the piece of the original project that is **not** in the repository.
The repo only contains its *output* (commits, PRs, branches) and its *runtime
state file* ([`.polly/registry.json`](../.polly/registry.json)). PollyArranger
is our effort to rebuild a working *equivalent* of the orchestrator itself,
starting from those traces.

This folder currently contains **design documentation only**. No runtime code
has been committed yet — the implementation language/runtime is deliberately
deferred until the design is settled (see [docs/06-roadmap.md](docs/06-roadmap.md)).

---

## What is Polly, in one paragraph

Polly turns *a single coding agent* into *a production line*. It takes a backlog
of work items, splits them into isolated branches, dispatches each to an
**implementer** agent (e.g. Claude Code), routes the result to a **reviewer**
agent **from a different vendor** (e.g. Codex) for adversarial cross-review,
loops fix→re-review until clean, and then parks the finished PR at a **human
merge gate**. It batches items into **waves** and tracks every item's live
state in a single registry file. The whole thing runs largely unattended.

We know this is exactly how it worked because the evidence is written into git
itself — branch names like `polly/p0-account-admin-auth`, PR sequences, and
cross-vendor `Co-authored-by` trailers. See [docs/DERIVATION.md](docs/DERIVATION.md)
for the trace-by-trace mapping.

---

## Use it (the turnkey CLI)

> **Using Polly on a project of your own? Read [USAGE.md](USAGE.md)** — the full
> step-by-step guide (point `--repo` at your folder, pick vendors, gates, merge
> mode, cost notes, Mac/Windows codex, troubleshooting).

Polly can run a backlog of specs through implement → cross-vendor review → merge
gate on a real repo, with one command:

```bash
cd PollyArranger
npm test                       # 59 tests, all offline — confirm it's healthy

# put your API keys in .env (gitignored): DEEPSEEK_API_KEY, DASHSCOPE_API_KEY (Qwen)
npm run polly -- run --repo /path/to/your/repo --spec "Add a /health endpoint returning 200"
#   or a backlog file (see examples/backlog.example.json):
npm run polly -- run --repo /path/to/your/repo --backlog backlog.json

npm run polly -- status --registry /path/to/your/repo/.polly/registry.json

# or run it as a daemon and feed it work from another shell:
npm run polly -- daemon --repo /path/to/your/repo        # keeps running (Ctrl-C to stop)
npm run polly -- add    --repo /path/to/your/repo --spec "Add a /metrics endpoint"
```

By default: DeepSeek implements, Qwen reviews (different families), `--concurrency 1`,
and `--merge human` (it parks finished work at `READY_FOR_HUMAN_MERGE` for you to
merge). A failing gate (`--gates`, default `npm test`) blocks the PR. Add
`--local-pr` to try it offline against a throwaway repo (stubs the PR + merges
locally). Run `npm run polly` with no args for all flags.

> Try it with zero setup: `npm run demo:pipeline` (live DeepSeek↔Qwen) or
> `npm run demo:waves` + `npm run status` (offline).

## How to read these docs

Read them in order. Each builds on the last.

| # | Doc | What it answers |
|---|-----|-----------------|
| 00 | [Overview](docs/00-overview.md) | Why Polly exists, what problem it solves, the core idea |
| 01 | [Architecture](docs/01-architecture.md) | The components and how data flows between them |
| 02 | [Data Model](docs/02-data-model.md) | The registry schema — the single source of truth |
| 03 | [State Machine](docs/03-state-machine.md) | The lifecycle every work item moves through |
| 04 | [Agent Adapters](docs/04-agent-adapters.md) | How Polly talks to different vendor agents uniformly |
| 05 | [Workflow Walkthrough](docs/05-workflow-walkthrough.md) | One item, start to finish, as a tutorial |
| 06 | [Roadmap](docs/06-roadmap.md) | Build order: the minimal closed loop first, then extras |
| 08 | [Providers](docs/08-providers.md) | Multi-vendor reference (DeepSeek, OpenAI, MiniMax, …) + config |
| 09 | [Scaling Roadmap](docs/09-scaling-roadmap.md) | **Design only** — plan to support large, long-running, interdependent projects (S1–S5) |
| — | [Glossary](docs/07-glossary.md) | Every term defined in one place |
| — | [Derivation](docs/DERIVATION.md) | How each design choice maps to a concrete trace in the repo |

Worked example of the state file:
[examples/registry.example.json](examples/registry.example.json).

---

## Design principles (the short version)

1. **The registry is the single source of truth.** Everything else
   (orchestrator loop, agents, git) is stateless and rebuildable from it.
2. **Build on open primitives, don't reinvent.** Git worktrees for isolation,
   `gh` for PRs, the Claude Agent SDK / vendor CLIs for the agents. Polly is the
   *glue and the decision logic*, not new low-level tech.
3. **Cross-vendor review is a feature, not an accident.** The implementer and
   reviewer should be *different* models so the review is genuinely adversarial.
4. **The human is a gate, not a bottleneck-by-default.** Polly does everything
   up to merge automatically; a human approves the merge (auto-merge is an
   opt-in policy, not the default).
5. **Headless first.** A fancy canvas UI (the original "CodeSurf") is explicitly
   out of scope. A log + the registry is enough to operate the line.

---

## Status

- [x] Design docs (this round)
- [ ] Runtime language/stack decision ([roadmap.md](docs/06-roadmap.md) Phase 0)
- [ ] MVP: the minimal closed loop (implement → cross-review → human merge)
- [ ] Wave batching, worktree pool, retry policy
- [ ] Optional: a read-only dashboard

See [docs/06-roadmap.md](docs/06-roadmap.md) for the full plan.
