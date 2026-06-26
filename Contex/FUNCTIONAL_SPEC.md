# Contex MCP Functional Specification

## 1. Product objective

Provide a local-first MCP coordination service for multiple AI or human-driven
tiles in a shared CodeSurf workspace. The service must make concurrent work
observable and reduce collisions without becoming the source of truth for code.

## 2. Design principles

1. **Coordination, not orchestration.** Contex connects workers; it does not
   decide the engineering workflow.
2. **Advisory claims, explicit conflicts.** File claims warn and coordinate.
   They do not silently lock the filesystem.
3. **Canvas links have meaning.** Linked tiles become discoverable peers.
4. **Agent-readable state.** Every important UI state has an MCP representation.
5. **Crash-tolerant.** Tiles may reconnect and resume without corrupting the
   workspace.
6. **Local-first security.** Bind to loopback and require short-lived tokens.
7. **Protocol compatibility.** Preserve historical `mcp__contex__*` aliases.

## 3. Actors

### Workspace owner

- creates or opens a workspace;
- authorizes local clients;
- creates and links tiles;
- can pause, terminate, or reassign work;
- can inspect audit history.

### Terminal agent

- registers its tile;
- publishes status, task, summary, and claimed files;
- reads linked-peer state;
- exchanges direct messages;
- creates or completes todos;
- reports completion or blockage.

### Chat tile

- displays human/agent conversation;
- accepts messages from linked terminal tiles;
- acknowledges messages;
- can send instructions back to terminals.

### Extension tile

- provides a custom UI or backend integration;
- uses a restricted bridge;
- may expose tile-specific actions.

### Memory daemon

- reads workspace events and selected files;
- emits durable summaries;
- does not directly edit source code.

## 4. Core capabilities

### 4.1 Workspace lifecycle

- create/open/archive workspace;
- issue scoped client token;
- list active and historical tiles;
- retain workspace ID independently of repository path;
- map one workspace to zero or one primary repository plus optional auxiliary
  paths.

### 4.2 Tile registration

Required registration fields:

- tile ID;
- tile type;
- display name;
- client instance ID;
- status;
- task summary;
- optional repository/worktree path;
- capabilities;
- protocol version.

On registration the server returns:

- normalized tile record;
- linked peers;
- current objective version;
- unread message count;
- active todos;
- conflicting file claims;
- heartbeat interval.

### 4.3 Presence and state

Supported status values:

- `idle`
- `working`
- `waiting`
- `blocked`
- `paused`
- `done`
- `error`
- `offline`

State updates may include:

- current task;
- progress text;
- files being read;
- files being edited;
- branch/worktree;
- completion summary;
- blocker;
- expected next action.

The service marks a tile offline after missed heartbeats but preserves its last
published state.

### 4.4 Peer graph

- tiles are nodes;
- canvas links are typed edges;
- peer discovery defaults to directly linked tiles;
- optional workspace-level discovery can expose all tiles;
- edge changes emit notifications and regenerate peer resources;
- capabilities are filtered by source/target tile type.

Suggested edge types:

- `collaborates_with`
- `reports_to`
- `feeds`
- `controls`
- `observes`
- `references`

The MVP may use an undirected `linked` edge while retaining a `kind` field for
future expansion.

### 4.5 Messaging

Features:

- direct tile-to-tile messages;
- workspace/channel broadcast;
- message acknowledgement;
- unread queue;
- correlation/reply IDs;
- human-attention priority;
- delivery and read timestamps;
- optional expiry.

Messages must be persisted before delivery so reconnecting clients can read
them.

### 4.6 Task and todo coordination

Two compatible layers:

1. **Tasks** — larger pieces of work with status, owner, blocker, and history.
2. **Todos** — lightweight assignments between peers.

Task status:

- `open`
- `assigned`
- `in_progress`
- `paused`
- `blocked`
- `review`
- `done`
- `cancelled`

Every transition creates an audit event.

### 4.7 File claims and conflict detection

Claims include:

- absolute or workspace-relative path;
- mode: `read`, `edit`, or `exclusive`;
- tile ID;
- timestamp;
- optional section/range description;
- expiry/heartbeat.

Conflict rules:

- read/read: no conflict;
- read/edit: informational;
- edit/edit: warning;
- exclusive/any other claim: blocking warning;
- claims from offline tiles become stale and require confirmation.

The server reports conflicts but does not mutate Git or files.

### 4.8 Objective and context

Each tile has:

- objective Markdown;
- enabled/disabled Skills;
- context attachments;
- current rules;
- version number;
- generated timestamp.

Updating the objective:

1. stores a new immutable version;
2. marks linked tile context stale;
3. emits `objective.reload_required`;
4. lets the agent fetch the latest resource;
5. records acknowledgement.

For compatibility, the server may render virtual files matching:

```text
.contex/tile-<id>/objective.md
.contex/tile-<id>/skills.json
.contex/tile-<id>/state.json
.contex/tile-<id>/peers.md
```

These should be MCP resources or cache files outside the repository by default.

### 4.9 Canvas command bus

Contex accepts validated commands and forwards them to CodeSurf:

- create tile;
- focus tile;
- connect/disconnect tiles;
- update tile title/badge;
- send terminal input;
- send chat message;
- request screenshot/export;
- highlight a tile requiring attention.

The server records command status:

- accepted;
- delivered;
- completed;
- failed;
- expired.

### 4.10 Notifications

Notification categories:

- peer message;
- conflict detected;
- objective reload;
- todo assigned;
- task blocked;
- human attention requested;
- tile offline;
- command failed;
- security event.

Clients receive notifications over MCP streaming when supported and poll as a
fallback.

### 4.11 Audit and replay

Every mutation creates an append-only event:

- actor;
- workspace;
- tile;
- event type;
- payload;
- timestamp;
- correlation ID.

The event log supports:

- debugging;
- session replay;
- workspace summaries;
- recovery after restart;
- input to the dreaming/memory daemon.

## 5. Permission model

Suggested scopes:

- `workspace:read`
- `workspace:manage`
- `tile:read`
- `tile:state`
- `tile:control`
- `message:send`
- `task:manage`
- `context:read`
- `context:write`
- `canvas:control`
- `audit:read`

A terminal agent normally receives state/message/task/context scopes but not
workspace administration.

## 6. Reliability requirements

- idempotency keys for all mutating tools;
- optimistic concurrency on tile/objective versions;
- heartbeat-based presence;
- durable message queue;
- transactional task transitions;
- event ordering per workspace;
- duplicate notification tolerance;
- graceful recovery if CodeSurf is disconnected;
- bounded message and audit retention.

## 7. Non-functional targets

- local response latency under 100 ms at p95;
- support at least 100 tiles and 1,000 links per workspace;
- support 20 concurrently active agents;
- restart recovery under 2 seconds for SQLite-sized workspaces;
- no network access required for local use;
- JSON logs with correlation IDs;
- exportable workspace bundle without secrets.
