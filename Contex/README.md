# Contex MCP Reconstruction

> This folder now uses the product's historical name: **Contex MCP**.
> Compatibility APIs retain the `contex` server key and
> `mcp__contex__*` tool aliases.

## Purpose

Contex is the coordination backend that sat behind the historical CodeSurf
Canvas. It is not the coding agent and it is not the canvas UI. Its job is to
connect tiles, agents, chats, tasks, context files, notifications, and canvas
commands through an MCP server.

The reconstruction is based on:

- committed MCP client configuration;
- the contex-managed `.claude/CLAUDE.md`;
- deleted `.contex/tile-*` files recovered from Git objects;
- historical `.codesurf/DREAMING.md` workspace memory;
- CodeSurf workflow scripts;
- PollyArranger reconstruction notes and Git history.

## Documents

- [EVIDENCE.md](EVIDENCE.md) — recovered facts, dates, files, confidence levels,
  and known gaps.
- [RECOVERED_ARTIFACTS.md](RECOVERED_ARTIFACTS.md) — sanitized tile snapshots,
  protocol generations, historical IDs, and Git object inventory.
- [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) — product responsibilities,
  components, behaviors, permissions, reliability, and compatibility.
- [MCP_API.md](MCP_API.md) — proposed MCP resources, tools, notifications,
  schemas, errors, and compatibility aliases.
- [DATA_MODEL.md](DATA_MODEL.md) — persistent entities, state machines, event
  records, storage choices, and migrations.
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — detailed phased implementation,
  tests, security work, observability, deployment, and acceptance criteria.
- [WORK_SCHEDULE.md](WORK_SCHEDULE.md) — Contex 与 CodeSurf 的推荐开发顺序、
  并行分工、分支策略和第一轮迭代任务。

## Reconstructed boundary

Contex owns:

- tile registration and liveness;
- peer/link graph;
- state and file-claim publication;
- direct messages and inboxes;
- shared tasks and todos;
- objective/context reload signaling;
- notifications requiring human attention;
- canvas command delivery;
- audit events and optional persistence.

Contex does not own:

- rendering the infinite canvas;
- terminal emulation or PTY processes;
- coding-agent model calls;
- Git branches, commits, worktrees, or pull requests;
- long-term project summarization;
- the Tiny World Builder runtime MCP bridge.

## Target architecture

```text
Claude/Codex/Agent ── MCP HTTP/SSE ──► Contex Server
                                           │
                                           ├── tile registry
                                           ├── peer graph
                                           ├── task/todo store
                                           ├── inbox + notifications
                                           ├── objective/context resources
                                           └── canvas command bus
                                                    │
                                                    ▼
                                             CodeSurf Canvas
```

## Compatibility goal

An existing agent configured with:

```json
{
  "mcpServers": {
    "contex": {
      "type": "http",
      "url": "http://127.0.0.1:<port>/mcp"
    }
  }
}
```

should be able to register, discover peers, exchange messages, update tasks,
and request canvas actions without changing its prompt.
