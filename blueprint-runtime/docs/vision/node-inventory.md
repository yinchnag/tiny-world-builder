# Blueprint Node Inventory

> **Note:** This inventories the *pre-Blueprint* surface for migration reference.
> Target node/edge/event shapes are defined in
> [`../architecture/00-overview.md`](../architecture/00-overview.md) §5, not here.

This document inventories the current CodeSurf and Contex node/function surface
before Blueprint-style changes. It answers:

- Which nodes exist today?
- What do they do?
- What are their inputs and outputs?
- Which capabilities are CodeSurf-local, Contex-backed, or integration-backed?

## CodeSurf Built-In Tile Types

CodeSurf currently exposes 9 built-in tile types through
`CodeSurf/public/tiles.mjs`.

| CodeSurf type | Current role | Inputs | Outputs | Backing |
| --- | --- | --- | --- | --- |
| `note` | Lightweight canvas note/context | Human-authored note text | Readable context for linked nodes | CodeSurf-local |
| `terminal` | Local process runner | command, args, stdin, env, Contex env | stdout, stderr, exit status, scrollback | CodeSurf process manager + optional Contex env |
| `agent` | Agent runtime tile | runtime command, profile, role, model, system prompt, messages | agent state, messages, reports, handoffs, human attention, timeline | CodeSurf terminal + Contex `agent_*` |
| `chat` | Human/agent chat surface | human message, linked recipients | messages and replies | CodeSurf UI + Contex messaging |
| `status` | Workspace status dashboard | Contex status-view | tasks, claims, Polly items, partial failures | CodeSurf UI + Contex tools |
| `git` | Repository status/worktree view | repository path, worktree path, branch | branch, dirty files, worktrees | CodeSurf server Git helpers |
| `memory` | Workspace memory/proposal panel | canvas/Git/tasks/pinned facts | proposal, evidence, pins, corrections, stale markers | CodeSurf memory helpers |
| `browser` | Embedded preview and findings | URL, finding text | iframe preview, finding records | CodeSurf browser tile |
| `document` | Markdown document/context node | text, repo file path, comments | markdown preview, selection/context, comments | CodeSurf-local + repo file read |

## Contex Tile Types

Contex currently accepts 8 `tile_type` values in `Contex/src/domain/tiles.mjs`.

| Contex tile_type | Current role | Typical CodeSurf mapping |
| --- | --- | --- |
| `terminal` | Process/agent-capable tile with terminal input semantics | `terminal`, `agent` |
| `chat` | Chat endpoint | `chat` |
| `document` | Document/context-bearing tile | `document` |
| `browser` | Browser/observation tile | `browser` |
| `extension` | External integration/plugin tile | Polly daemon, future plugins |
| `status` | Status/monitoring tile | `status` |
| `memory` | Memory/context tile | `memory` |
| `unknown` | Forward-compatible placeholder | unknown future tiles |

Important gaps:

- CodeSurf `note` has no Contex tile type.
- CodeSurf `git` has no Contex tile type.
- CodeSurf `agent` is represented in Contex as a semantic layer over a tile,
  usually `terminal`, with capability markers such as `agent`, `role:<role>`,
  and `runtime:<runtime>`.

## Current Link Kinds

Contex and CodeSurf now preserve these semantic link kinds:

```text
collaborates_with
reports_to
feeds
controls
observes
references
handoff
reviews
review
broadcast_group
```

Current links are primarily tile-to-tile. They do not yet store port identities
or payload types.

## Current CodeSurf Capabilities

| Capability | Primary nodes | Contex involvement |
| --- | --- | --- |
| Infinite canvas editing | all CodeSurf tiles | none |
| Tile persistence/layout | all CodeSurf tiles | none |
| Semantic visual links | all linked tiles | mirrored through `link_tiles` |
| Local process execution | `terminal`, `agent` | Contex env injection when connected |
| Agent runtime launch | `agent` | `agent_register`, messages, state |
| Agent collaboration actions | `agent` | `agent_claim_task`, `agent_complete_task`, `agent_request_handoff`, `agent_report`, `agent_broadcast` |
| Chat with linked peers | `chat`, `agent` | `peer_send_message`, `peer_read_messages` |
| Human attention panel | `agent`, workspace attention feed | `agent_request_human_input`, human attention endpoints |
| Timeline/activity | `agent`, workspace activity feed | `get_agent_timeline`, `get_workspace_timeline` |
| Status dashboard | `status` | `list_peers`, `list_tasks`, `list_file_claims`, Polly tools |
| Git state | `git` | none today |
| Memory proposal | `memory` | can consume Contex tasks/events indirectly |
| Browser preview/findings | `browser` | findings may be sent through messages later |
| Document editing/context | `document` | context attachments/objectives can reference docs |
| Workflow presets | `agent`, `chat`, links | links mirrored, no first-class workflow asset yet |

## Current Contex Capabilities

### Peer And Tile State

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `peer_set_state` | Register/update tile state and file claims | terminal/agent/integration nodes |
| `peer_get_state` | Read self, linked peers, available tools, conflicts | agent/terminal runtime |
| `list_peers` | Status-panel compatibility view of agents as peers | status node |
| `list_file_claims` | Active claim list | status node |

### Messaging

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `peer_send_message` | Direct tile-to-tile message | terminal/chat/agent |
| `peer_read_messages` | Read tile inbox | terminal/chat/agent |
| `chat_send_message` | Send to chat tile | chat/agent |
| `chat_acknowledge` | Acknowledge chat message | chat/agent |

### Agent Semantics

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `agent_register` | Register semantic Agent | agent |
| `agent_update_state` | Update Agent state/task/summary | agent/status |
| `agent_list` | Query Agents | status/router |
| `agent_send_message` | Agent-to-Agent message | agent |
| `agent_read_messages` | Agent inbox | agent |
| `agent_claim_task` | Claim task | agent/status |
| `agent_complete_task` | Complete task lifecycle | agent/status |
| `agent_request_handoff` | Hand off work | agent |
| `agent_report` | Report result | agent |
| `agent_broadcast` | Broadcast by selector | agent/router |
| `agent_request_human_input` | Raise human attention | agent/human gate |

### Tasks And Context

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `create_task` | Create durable task | task/router/agent |
| `list_tasks` | List tasks | status/task node |
| `update_task` | Transition/update task | status/agent |
| `pause_task` | Pause task with blocker | status/human gate |
| `set_objective` | Set tile objective | document/objective/agent |
| `set_skill` | Enable/disable skill | agent/context |
| `add_context_attachment` | Attach file/url/snippet | document/browser/memory |
| `get_context` | Read objective, skills, peers, tasks, attachments | agent |
| `reload_objective` | Fetch and acknowledge objective | agent |

### Canvas Command Bus

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `canvas_create_tile` | Ask CodeSurf to create a tile | agent/workflow runtime |
| `terminal_send_input` | Send terminal input/control | agent/terminal |
| `canvas_focus` | Focus a tile | workflow/debugger |
| `canvas_highlight` | Highlight a tile | workflow/debugger |
| `canvas_connect` | Ask CodeSurf to connect tiles | workflow/runtime |
| `canvas_next_commands` | CodeSurf pulls pending commands | CodeSurf server |
| `canvas_complete_command` | CodeSurf completes command | CodeSurf server |

### Timeline, Audit, Export

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `get_workspace_timeline` | Workspace event timeline | status/debugger/memory |
| `get_agent_timeline` | Per-agent timeline | agent/debugger |
| `get_audit_log` | Raw audit feed | memory/export/debugger |
| `export_workspace` | Redacted state export | memory/diagnostics |

### Polly Integration

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `polly_sync_snapshot` | Observe Polly registry snapshot | Polly observer/status |
| `polly_request_action` | Record operator request for Polly | status/human/operator |
| `polly_list_action_requests` | List requests | status/Polly node |
| `polly_record_action_result` | Polly records outcome | Polly daemon |

### Admin / Import

| Tool | Purpose | Node usage |
| --- | --- | --- |
| `issue_client_token` | Issue scoped token | admin/security |
| `revoke_client_token` | Revoke token | admin/security |
| `list_client_tokens` | List token prefixes/scopes | admin/security |
| `import_tile_dir` | Import legacy `.contex/tile-*` data | migration/admin |

## Polly Current Model

Polly is not yet a CodeSurf node family. It is represented through Contex as:

- a deterministic daemon/integration identity;
- Contex tasks mapped from Polly items;
- file claims and worktree visibility;
- human-attention events for blocked or ready-for-merge items;
- operator requests that Polly may accept/reject/apply.

Existing design reference:

```text
Contex/POLLY_ARRANGER_INTEGRATION.md
Contex/src/domain/polly.mjs
Contex/test/polly.test.mjs
```

Blueprint implication: Polly should become an Integration/Observer node family,
not a replacement for Polly's own scheduler.

## Current Gaps For Blueprint Direction

- No explicit node contract registry.
- No input/output ports.
- Links are tile-to-tile, not port-to-port.
- Links do not yet carry `payload_type` or `lane`.
- Contex timeline events do not consistently include node/port/edge metadata.
- Workflow presets are imperative UI actions, not reusable graph assets.
- Agent panels currently contain multiple responsibilities that should become
  separate graph nodes over time.
- Polly is visible through status/task data, not through first-class node
  contracts.
