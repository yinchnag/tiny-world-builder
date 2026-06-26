# Recovered Contex Artifacts

This document records sanitized data recovered from Git history. Authentication
tokens and user-specific absolute paths are intentionally omitted or shortened.

## 1. Recovered tile inventory

### Tile `tile-1779176041759`

Observed files:

```text
objective.md
skills.json
state.json
peers.md
```

Observed characteristics:

- terminal-like working tile;
- large user-level Skill and Command discovery list;
- channel `tile:tile-1779176041759`;
- linked to chat tile `tile-1779624672511`;
- task list initially empty;
- not paused.

### Tile `tile-1779624672511`

Observed files:

```text
peers.md
```

Observed characteristics:

- identified as type `chat`;
- linked back to `tile-1779176041759`;
- exposed `chat_send_message` and `chat_acknowledge` actions.

### Tile `tile-1780832070725`

Observed files:

```text
objective.md
skills.json
state.json
```

Observed characteristics:

- created for a repository-specific task;
- enabled TinyWorld i18n Skill;
- exposed standard conversation commands;
- task list empty;
- not paused.

## 2. Sanitized first-generation objective shape

```markdown
# Objective

## Available Skills & Tools
- @discovered-<skill-path> — <description>
- @command:/clear — Clear conversation
- @command:/compact — Compact conversation
- @command:/export-notes — Copy attached block notes
- @command:/help — Show help
- @command:/init — Initialize workspace
- @command:/mode — Switch mode
- @command:/model — Switch model

## Communication Protocol

| Tool | When |
|------|------|
| update_task(channel, task_id, status) | Update task status |
| create_task(channel, title) | Create a new task |
| reload_objective(tile_id) | Get latest objective |
| pause_task(channel, task_id, reason) | Pause a task |
| get_context(tile_id) | Read context files |
| notify(channel, message) | Send notification |

Your tile channel: tile:<tile-id>

## Rules
1. Re-read this file when you receive a reload signal
2. Update task status via MCP tools as you work
3. Call notify when you need human attention
```

## 3. Sanitized Skills shape

```json
{
  "enabled": [
    "discovered-<absolute-or-repository-skill-path>",
    "command:/clear",
    "command:/compact",
    "command:/export-notes",
    "command:/help",
    "command:/init",
    "command:/mode",
    "command:/model"
  ],
  "disabled": []
}
```

The large historical tile listed user-level Skills such as:

- browser automation;
- configuration housekeeping;
- CodeSurf extension development;
- collaboration canvas;
- context save/restore;
- contract execution;
- model benchmarking;
- agent building;
- planning and review;
- QA and web testing;
- Skill creation;
- visual explanation.

This proves discovery was broader than repository-local Skills.

## 4. Sanitized state shape

```json
{
  "tasks": [],
  "paused": false
}
```

No richer historical task instance was recovered from these tile snapshots.
Task field details in the reconstruction are therefore proposed.

## 5. Sanitized peer resource shape

```markdown
# Connected Peers

These blocks are linked to you on the canvas. Use MCP peer bridge tools to
interact with them.

## chat — `tile-<peer-id>`
Available tools:
- `mcp__contex__chat_send_message`
- `mcp__contex__chat_acknowledge`

---
This file is auto-updated when canvas links change.
Use `reload_objective` or re-read this file for the latest state.
```

## 6. Second-generation agent instructions

The later contex-managed protocol requires:

```text
peer_set_state(tile_id, tile_type, status, task)
peer_get_state(tile_id)
```

Work protocol:

1. register as idle;
2. inspect linked peers;
3. mark working with task;
4. publish current files;
5. coordinate if a peer lists the same files;
6. read incoming messages;
7. assign shared todos where useful;
8. mark done with summary;
9. complete relevant todos.

## 7. Historical MCP configuration shape

Early:

```json
{
  "mcpServers": {
    "contex": {
      "type": "http",
      "url": "http://127.0.0.1:<dynamic-port>/mcp"
    }
  }
}
```

Later:

```json
{
  "mcpServers": {
    "contex": {
      "type": "http",
      "url": "http://127.0.0.1:<dynamic-port>/mcp",
      "headers": {
        "Authorization": "Bearer <redacted>"
      }
    }
  }
}
```

## 8. Git object timeline

| Date | Commit | Observation |
|---|---|---|
| 2026-05-19 | `b602e933` | Early workspace memory and Contex protocol traces |
| 2026-05-24–26 | multiple | Tile and peer files survive across agent branches |
| 2026-06-03 | `e4156f2`, `1114a5c` | MCP configuration updates |
| 2026-06-07 | `1a66f99` | Memory, ignore rules, and MCP config updated |
| 2026-06-08 | `e8ecefb` | New tile created with objective, Skills, and state |
| 2026-06-09 | `ea60b20` | Runtime tile files deleted and `.contex` ignored |
| 2026-06-15 | `9ca5be1` | MCP configuration updated again |
| 2026-06-22–23 | multiple | MCP config and CodeSurf memory continue changing |

## 9. Historical versus proposed fields

Confirmed historical fields:

- tile ID;
- tile type;
- status;
- task text;
- files array in peer state;
- enabled/disabled Skills;
- tasks array;
- paused flag;
- tile channel;
- linked peers;
- available peer tools.

Proposed reconstruction fields:

- progress percentage;
- typed file-claim modes;
- workspace ID;
- message priority;
- optimistic version;
- idempotency key;
- task priority/due date;
- audit event schema;
- token scopes.
