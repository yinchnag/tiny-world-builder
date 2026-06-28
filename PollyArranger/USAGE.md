# Using Polly on your own project

Polly runs a backlog of tasks through **implement → cross-vendor review → merge
gate** on any git repo: one AI writes the code, a *different* AI reviews it, and
finished work is parked for you to merge (or auto-merged). This guide is how to
point it at a project folder of your own.

> **Mental model:** PollyArranger is the *tool* (lives in its own folder). Your
> *target project* is a separate git repo. You run `npm run polly` from inside
> PollyArranger and pass `--repo <path-to-your-project>`.
>
> **You do NOT put PollyArranger inside your project.** They stay separate:
>
> ```
> ~/anywhere/PollyArranger/     ← the tool — run `npm run polly` here
> ~/code/your-project/          ← a separate git repo — pass it via --repo
> ```
>
> PollyArranger is fully **self-contained (zero npm dependencies)**, so you can
> copy the `PollyArranger/` folder anywhere and use it as a standalone tool
> pointed at any project:
>
> ```bash
> cp -r tiny-world-builder/PollyArranger ~/tools/PollyArranger   # (+ your .env)
> cd ~/tools/PollyArranger
> npm run polly -- run --repo /path/to/any/project --spec "..."
> ```

---

## 1. Prerequisites

- **Node.js ≥ 18** and **git** on PATH.
- At least **two vendors of different families**, one to implement and one to
  review. What you have:
  - `claude_code` — the `claude` CLI, **no key needed** (uses its own login).
  - `codex` — the `codex` CLI, **no key needed** (home Mac/Windows).
  - `deepseek` / `qwen` — API keys in `.env` (cheap; great reviewers).
- Your **target project must be a git repo** with at least one commit on the base
  branch (default `main`).

## 2. One-time setup

```bash
# get PollyArranger (it's on your fork, on the `pollyarranger` branch)
git clone https://github.com/yinchnag/tiny-world-builder
cd tiny-world-builder
git checkout pollyarranger
cd PollyArranger

npm test          # 78 tests, all offline — confirms it's healthy (no API used)
```

Put your API keys in `PollyArranger/.env` (gitignored — never committed):

```
DEEPSEEK_API_KEY=sk-...
DASHSCOPE_API_KEY=...        # Qwen (mainland endpoint)
# claude_code / codex need NO key here — they use the CLI's own auth
```

> Harness vendors (`claude_code`/`codex`) just need the CLI installed and logged
> in on that machine. Polly passes them no key.

## 3. Quick start — try it fully locally (no GitHub, no remote)

`--local-pr` makes a run **completely local**: no pushing, no PRs, merges happen
on your local branch. Safest way to try it on a throwaway or a real repo.

```bash
npm run polly -- run \
  --repo /path/to/your/project \
  --spec "Add a function add(a,b) in math.mjs returning a+b, with a JSDoc" \
  --vendors claude_code,deepseek \
  --gates "node --version" \
  --local-pr --merge auto
```

What happens: Polly makes a worktree/branch, **Claude** writes the code and
commits, **DeepSeek** reviews the diff; if clean it merges into your base branch
locally; then it prints a status report. Inspect the result with `git log` /
`git show` on your project.

> The first `claude -p` run may take ~15–30s to warm up. Each model call costs
> real money — Claude (Opus) is the pricey one; DeepSeek/Qwen are cheap.

## 4. The commands

```bash
npm run polly -- plan   --repo <p> --goal "..." [--planner <v>] [--out <file>]
npm run polly -- run    --repo <p> (--spec "..."|--backlog file.json) [options]
npm run polly -- status  --registry <p>
npm run polly -- history --registry <p> [--item p1]    # full implement<->review trail
npm run polly -- daemon  --repo <p> [--interval 5]     # keep running; Ctrl-C to stop
npm run polly -- add     --repo <p> (--spec "..."|--backlog file.json)  # queue work
```

> **`history`** shows the whole back-and-forth — every implement lap and every
> review round (each reviewer verdict + findings), not just the latest. Great for
> seeing *why* an item ended up `BLOCKED` (e.g. what the reviewer kept flagging).

> ⚠️ **Windows / PowerShell:** `npm run polly -- …` strips the `--flag` names
> when forwarding (you'll get `--repo <path> is required`). Call the script
> **directly** instead, and quote comma values:
>
> ```powershell
> node src/cli.mjs run --repo D:\path\to\project --spec "..." --vendors "claude_code,deepseek" --gates "node --version" --local-pr --merge auto
> ```
>
> The target repo must already be a git repo with a `main` branch + one commit:
> ```powershell
> cd D:\path\to\project ; git init -b main ; git commit --allow-empty -m init
> ```

- **plan** — ask an agent to decompose a goal into a backlog file (with ids,
  `dependsOn`, `tags`) for you to **review/edit**, then run it:
  ```bash
  npm run polly -- plan --repo /path/to/project --goal "Add user auth (signup, login, JWT)" --planner deepseek
  # edit <repo>/.polly/plan.json, then:
  npm run polly -- run  --repo /path/to/project --backlog /path/to/project/.polly/plan.json --vendors claude_code,deepseek --local-pr
  ```
- **run** — seed the task(s), process until idle, print status.
- **status** — print the current state (items, what's ready/blocked, cost).
- **daemon** — stay running and pick up work added later (via `add`).
- **add** — append task(s) to the registry (e.g. to feed a running daemon).

A backlog file is a JSON array of strings or objects. An object may set an
explicit `id` (lowercase alphanumeric) and `dependsOn` (ids that must be **merged
first**), so you can order interdependent tasks:

```json
[
  { "id": "schema", "title": "DB schema", "spec": "Create the users table…" },
  { "id": "api", "title": "REST API", "spec": "Add /users…", "dependsOn": ["schema"] },
  { "id": "ui",  "title": "Frontend",  "spec": "List users…", "dependsOn": ["api"] }
]
```

Polly won't start a task until all its `dependsOn` are MERGED (independent tasks
still run in parallel). Cycles / unknown deps are rejected up front. `polly status`
shows a **WAITING on dependencies** section. See
[examples/backlog.example.json](examples/backlog.example.json).

## 5. Choosing vendors (who writes, who reviews)

`--vendors implementer,reviewer` — the **first** implements, the **second**
reviews. They must be different families.

| You want | Flag | Where |
|----------|------|-------|
| Claude writes, DeepSeek reviews | `--vendors claude_code,deepseek` | work machine (has claude) |
| Claude writes, Qwen reviews | `--vendors claude_code,qwen` | work machine |
| Codex writes, DeepSeek reviews | `--vendors codex,deepseek` | home (has codex) |
| DeepSeek writes, Qwen reviews | `--vendors deepseek,qwen` | anywhere (API only, cheapest) |

## 6. The options that matter

| Option | Default | Meaning |
|--------|---------|---------|
| `--merge human` | **human** | Park finished work at `READY_FOR_HUMAN_MERGE` for you to merge. Use `--merge auto` to merge automatically. |
| `--gates "<cmd>"` | `npm test` | Runs in each worktree; **a red gate blocks the PR** and sends the task back to fix it. For a project with no tests, use e.g. `--gates "node --version"` (always passes) or your real build/lint command. |
| `--local-pr` | off | Fully local: no remote, no GitHub, merges locally. Drop it to open **real PRs** via `gh` (needs `gh` logged in + push access). |
| `--concurrency <n>` | `1` | Run N tasks in parallel (safe — git ops are repo-locked). |
| `--implementer <v>` / `--reviewer <v>` | routed | Force default roles (e.g. `--implementer deepseek --reviewer qwen`). |
| `--routing <file>` | — | Routing JSON: `{ "default": {...}, "rules": [{ "tag": "hard", "implementer": "claude_code" }] }`. Tag items in the backlog (`"tags": ["hard"]`) to route them. |
| `--escalate-to <v>` | off | If review can't converge, retry once with vendor `<v>` (must be in `--vendors`) before BLOCKED. |
| `--memory <file>` | `<repo>/.polly/memory.md` | Project memory injected into every implement/review prompt. Edit it to record conventions/decisions agents must respect. |
| `--scribe` | off | Append a one-line record to memory when a task merges (so the project accrues memory). View with `polly memory --repo <p>`. |
| `--base <branch>` | `main` | Base branch to fork from. |
| `--wave <id>` | — | Tag tasks into a wave for grouped reporting. |
| `--registry <path>` | `<repo>/.polly/registry.json` | Where state is stored. |

## 7. Optional Contex visibility

Polly can push observe-only snapshots into Contex after registry saves. This is
optional: if Contex is unavailable, Polly logs the sync failure and keeps running
from `.polly/registry.json`.

```bash
npm run polly -- daemon --repo /path/to/project \
  --contex \
  --contex-url http://127.0.0.1:7777/mcp \
  --contex-token env:CONTEX_TOKEN \
  --contex-workspace ws_1
```

Environment fallback:

```bash
POLLY_CONTEX_SYNC=1
CONTEX_URL=http://127.0.0.1:7777/mcp
CONTEX_TOKEN=...
CONTEX_WORKSPACE=ws_1
```

With Contex enabled, `run`, `daemon`, and `add` sync snapshots through the
`polly_sync_snapshot` MCP tool. Contex remains read-only for Polly in this mode.

## 8. Running against a REAL project (recommended flow)

Park work for your review instead of auto-merging, and use your real test suite
as the gate:

```bash
# fully local, human gate, real tests as the gate:
npm run polly -- run --repo /path/to/project \
  --backlog tasks.json --vendors claude_code,deepseek \
  --gates "npm test" --local-pr

# then review what it produced:
npm run polly -- status --registry /path/to/project/.polly/registry.json
cd /path/to/project && git log --oneline --all   # inspect the polly/* branches
```

Each finished task sits on its own `polly/<id>-<slug>` branch at
`READY_FOR_HUMAN_MERGE`. Check out the branch, review the diff, and merge it
yourself when happy.

**To open real GitHub PRs** instead: drop `--local-pr` (the branch is pushed to
`origin` and `gh pr create` opens a PR). Requires `gh auth login` and push access.

## 9. Codex on Mac / Windows (home machines)

Codex is a harness CLI like Claude — no key. Defaults usually work on macOS. On
Windows the `codex` shim often needs a shell + stdin:

```bash
# macOS (usually just works):
npm run polly -- run --repo <p> --spec "..." --vendors codex,deepseek --local-pr

# Windows (run codex.cmd via a shell, send the prompt over stdin):
npm run polly -- run --repo <p> --spec "..." --vendors codex,deepseek --local-pr \
  --harness-shell --harness-stdin
```

First time on a machine, check `codex --help` (and `codex exec --help`) to confirm
the headless subcommand. See [docs/08-providers.md](docs/08-providers.md) for the
full per-machine checklist.

## 10. What Polly creates in your project (and gitignore)

Inside your target repo it uses:

- `.polly/registry.json` — the pipeline state (single source of truth).
- `.polly/transcripts/` — saved agent conversations (for fix-lap resume).
- `.worktrees/<id>-<slug>/` — an isolated git worktree per task.

Add these to your project's `.gitignore`:

```
.polly/
.worktrees/
```

(The `polly/*` branches are real branches in your repo — that's intended; delete
them after merging if you like.)

## 11. Cost awareness

Every model call is real money. Rough guide: **Claude (Opus)** is the expensive
implementer (a real multi-file task can be cents to a couple dollars);
**DeepSeek/Qwen** reviewers are very cheap. The status report prints total tokens;
`--output-format json` cost is tracked per item. Start with one small task.

## 12. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Item goes `BLOCKED` immediately | Your `--gates` command fails (e.g. `npm test` with no test script). Use a passing gate or your real command. |
| `unknown vendor "x"` | Use `claude_code`, `codex`, `deepseek`, `qwen`, … (see [docs/08](docs/08-providers.md)). |
| Claude/codex “command not found” | Pass `--harness-command <path-or-name>` (e.g. `codex.cmd` on Windows). |
| Windows codex hangs/garbles the prompt | Add `--harness-shell --harness-stdin`. |
| `claude` stalls on a workspace-trust prompt | Pre-trust the repo dir once interactively, or tell me and we add the flag. |
| Push fails on `--local-pr` | Shouldn't happen now — `--local-pr` is fully local (no push). Update to the latest `pollyarranger`. |
| Want to reset | Delete `<repo>/.polly/` and the `polly/*` branches + `.worktrees/`. |

## 13. Cheat sheet

```bash
# fastest real try (local, auto-merge, Claude+DeepSeek):
npm run polly -- run --repo <p> --spec "..." --vendors claude_code,deepseek --gates "node --version" --local-pr --merge auto

# real project, your tests as the gate, parked for your review:
npm run polly -- run --repo <p> --backlog tasks.json --vendors claude_code,deepseek --gates "npm test" --local-pr

# parallel batch:
npm run polly -- run --repo <p> --backlog tasks.json --vendors claude_code,deepseek --concurrency 3 --local-pr --merge auto

# always-on:
npm run polly -- daemon --repo <p> --vendors claude_code,deepseek --local-pr --merge auto
npm run polly -- add    --repo <p> --spec "next task"

# see what happened:
npm run polly -- status --registry <p>/.polly/registry.json
```

Run `npm run polly` with no arguments for the full flag list.
