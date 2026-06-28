# Contex MCP API Draft

## 1. Transport

Primary transport:

```text
HTTP MCP endpoint: http://127.0.0.1:<dynamic-port>/mcp
```

Requirements:

- MCP protocol negotiation;
- bearer authentication;
- server-sent streaming or equivalent MCP notification transport;
- loopback binding by default;
- health endpoint outside MCP for launcher supervision.

Compatibility server name:

```text
contex
```

## 2. MCP resources

### `context://workspace/{workspaceId}`

Workspace metadata, repository path, active tile count, and revision.

### `context://workspace/{workspaceId}/graph`

Nodes and edges visible to the caller.

### `context://tile/{tileId}/objective`

Latest objective Markdown and version.

### `context://tile/{tileId}/skills`

Enabled/disabled skills and discovery metadata.

### `context://tile/{tileId}/state`

Current status, task, files, blocker, and heartbeat.

### `context://tile/{tileId}/peers`

Linked peers and allowed actions. A text renderer should preserve the historical
`peers.md` format.

### `context://tile/{tileId}/inbox`

Unread or recent messages.

### `context://workspace/{workspaceId}/tasks`

Workspace task and todo view.

### `context://workspace/{workspaceId}/timeline`

Normalized Agent collaboration timeline for the workspace. Items include stable
`category`, `summary`, original `payload`, sequence, actor, tile, and entity
fields.

### `context://tile/{tileId}/timeline`

Normalized timeline for one Agent/tile, filtered to status, message, task, and
link events involving that tile.

### `context://workspace/{workspaceId}/audit`

Permission-gated event stream.

## 3. Modern tools

### `peer_set_state`

```json
{
  "tile_id": "tile-1779176041759",
  "tile_type": "terminal",
  "status": "working",
  "task": "Implement settings panel",
  "progress": "Editing rendering controls",
  "files": [
    {
      "path": "engine/world/30-ui-boot-wiring.js",
      "mode": "edit"
    }
  ],
  "branch": "feature/settings",
  "worktree": "/repo/.worktrees/settings",
  "summary": null,
  "blocker": null,
  "expected_version": 12,
  "idempotency_key": "uuid"
}
```

Returns normalized state, new version, conflicts, and linked peer summary.

### `peer_get_state`

Input:

```json
{
  "tile_id": "tile-1779176041759",
  "include_workspace": false,
  "include_offline": false
}
```

Returns the current tile plus linked peer states and file conflicts.

### `peer_send_message`

```json
{
  "from_tile_id": "tile-a",
  "to_tile_id": "tile-b",
  "text": "I need to edit 30-ui-boot-wiring.js. Are you still using it?",
  "priority": "normal",
  "reply_to": null,
  "requires_ack": true,
  "idempotency_key": "uuid"
}
```

### `peer_read_messages`

Supports unread-only reads, pagination, and optional acknowledgement.

### `peer_add_todo`

```json
{
  "creator_tile_id": "tile-a",
  "assignee_tile_id": "tile-b",
  "title": "Verify the settings modal in browser",
  "description": "Check desktop and mobile widths",
  "priority": "normal",
  "due_at": null
}
```

### `peer_complete_todo`

Requires todo ID, completing tile, and optional result summary.

### `canvas_create_tile`

```json
{
  "requester_tile_id": "tile-a",
  "tile_type": "terminal",
  "title": "Settings visual QA",
  "objective": "Verify the new settings controls",
  "skills": ["tinyworld-visual-qa"],
  "position_hint": {
    "relative_to": "tile-a",
    "direction": "right"
  },
  "link_to_requester": true
}
```

Returns a command ID and, after CodeSurf accepts it, a new tile ID.

### `terminal_send_input`

Permission-gated. Sends text or a control action to a terminal tile.

Safety:

- caller must be linked or workspace owner;
- target tile must advertise terminal input capability;
- destructive control sequences require elevated permission;
- all input is audited.

### `chat_send_message`

Sends a human-readable message to a chat tile.

### `chat_acknowledge`

Acknowledges receipt or completion of a chat request.

### `notify`

Creates a workspace notification, including `human_attention` priority.

### `agent_register`

Registers an Agent identity backed by an existing Contex tile row. Phase 2 does
not add new tables; agent metadata is stored as stable capability markers:
`agent`, `role:<role>`, and `runtime:<runtime>`.

```json
{
  "agent_id": "agent_worker_1",
  "tile_id": "terminal_worker_1",
  "runtime": "codex",
  "role": "worker",
  "display_name": "Worker 1",
  "capabilities": ["chat", "code_edit"],
  "status": "idle",
  "task": "Waiting for work"
}
```

### `agent_update_state`

Updates an Agent's status, task, progress, summary, blocker, branch, worktree,
or capabilities without requiring callers to know the lower-level
`peer_set_state` schema.

### `agent_list`

Lists registered Agents in a workspace. Optional filters: `role`, `runtime`,
`status`, and `capability`.

### `agent_send_message`

Sends a link-gated message from one Agent to another Agent/tile. Directed links
allow source → target messages only; undirected links allow both directions.

### `agent_read_messages`

Reads messages addressed to an Agent, marking them delivered/read and optionally
acknowledged.

### `agent_claim_task`

Claims an open or already-owned task for an Agent. Open tasks move to
`assigned`; already-assigned work can move to `in_progress`.

```json
{
  "agent_id": "agent_worker_1",
  "task_id": "task_123",
  "status": "in_progress",
  "expected_version": 2
}
```

### `agent_complete_task`

Completes a task for an Agent, walking the existing lifecycle through `review`
to `done` when needed and storing an optional result summary.

### `agent_request_handoff`

Moves task ownership to another linked Agent/tile and sends an ack-required
handoff message.

```json
{
  "from_agent_id": "agent_worker_1",
  "to_agent_id": "agent_reviewer_1",
  "task_id": "task_123",
  "text": "Please review this implementation."
}
```

### `agent_report`

Sends a linked report message from one Agent to another Agent/tile, optionally
updating a task result summary.

### `agent_broadcast`

Sends a link-gated broadcast to Agents selected by `role`, `runtime`, `status`,
or `capability`. Delivery is attempted per selected recipient; unlinked
recipients are reported as failures instead of bypassing link policy.

### `agent_request_human_input`

Puts an Agent into `waiting` or `blocked` state and emits
`notifications/context/human_attention`. Use this when an Agent reaches a
permission boundary, missing credential, destructive operation, or major product
decision that needs the human.

```json
{
  "agent_id": "agent_worker_1",
  "question": "May I modify files outside the project folder?",
  "severity": "permission",
  "task_id": "task_123"
}
```

### `get_agent_timeline`

Reads a normalized status/message/task timeline for one Agent/tile.

```json
{
  "agent_id": "agent_worker_1",
  "since_sequence": 120,
  "limit": 50
}
```

### `get_workspace_timeline`

Reads a normalized workspace-wide Agent collaboration timeline.

### `get_context`

Returns objective, skills, selected memory, peers, tasks, and attachments for a
tile. Large attachments should be returned as resources rather than inline.

### `reload_objective`

Fetches the latest objective and records acknowledgement of its version.

## 4. First-generation compatibility tools

### `create_task(channel, title)`

Alias for task creation where `channel` resolves to a tile or workspace.

### `update_task(channel, task_id, status)`

Alias for a validated task transition.

### `pause_task(channel, task_id, reason)`

Transitions to `paused` and stores the blocker/reason.

Tool aliases should remain under the historical prefix:

```text
mcp__contex__create_task
mcp__contex__update_task
mcp__contex__pause_task
```

## 5. Notifications

Suggested MCP notifications:

- `notifications/context/tile_state_changed`
- `notifications/context/peer_link_changed`
- `notifications/context/message_received`
- `notifications/context/todo_assigned`
- `notifications/context/objective_reload_required`
- `notifications/context/file_conflict`
- `notifications/context/canvas_command_result`
- `notifications/context/human_attention`

## 6. Error codes

| Code | Meaning |
|---|---|
| `CONTEXT_AUTH_REQUIRED` | Missing or invalid token |
| `CONTEXT_SCOPE_DENIED` | Token lacks required scope |
| `CONTEXT_TILE_NOT_FOUND` | Unknown tile |
| `CONTEXT_PEER_NOT_LINKED` | Direct action requires a link |
| `CONTEXT_VERSION_CONFLICT` | Optimistic concurrency failure |
| `CONTEXT_FILE_CONFLICT` | Exclusive claim collision |
| `CONTEXT_OBJECTIVE_STALE` | Client must reload objective |
| `CONTEXT_CANVAS_OFFLINE` | Command queued but canvas disconnected |
| `CONTEXT_COMMAND_REJECTED` | CodeSurf rejected command |
| `CONTEXT_RATE_LIMITED` | Client exceeded limit |
| `CONTEXT_INVALID_TRANSITION` | Illegal task/status transition |

## 7. Rate limits

Local defaults per token:

- heartbeat/state updates: 120/min;
- peer reads: 120/min;
- messages: 60/min;
- canvas creation: 10/min;
- terminal input: 30/min;
- objective updates: 10/min.

## 8. Versioning

- expose server semantic version;
- expose protocol capability flags;
- retain historical aliases for at least one major version;
- reject unknown fields only where security-sensitive;
- support additive schema evolution.
