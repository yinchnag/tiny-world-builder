# Contex MCP Data Model

## 1. Storage recommendation

Use SQLite for local-first operation:

- one database per user installation;
- workspace IDs separate data belonging to different repositories;
- WAL mode for concurrent readers;
- foreign keys enabled;
- append-only events plus normalized current-state tables.

PostgreSQL can be added later for remote/team mode.

## 2. Entities

### Workspace

```text
id
name
repository_path
created_at
updated_at
archived_at
revision
settings_json
```

### Tile

```text
id
workspace_id
type
title
display_name
status
task
progress
summary
blocker
branch
worktree
client_instance_id
capabilities_json
version
last_seen_at
created_at
updated_at
closed_at
```

Tile types:

- terminal
- chat
- document
- browser
- extension
- status
- memory
- unknown

### TileLink

```text
id
workspace_id
source_tile_id
target_tile_id
kind
directed
metadata_json
created_at
deleted_at
```

### FileClaim

```text
id
workspace_id
tile_id
path
mode
section
created_at
refreshed_at
expires_at
released_at
```

### Message

```text
id
workspace_id
from_tile_id
to_tile_id
channel
reply_to_id
priority
text
metadata_json
requires_ack
created_at
delivered_at
read_at
acknowledged_at
expires_at
```

### Task

```text
id
workspace_id
channel
title
description
status
priority
owner_tile_id
creator_tile_id
blocker
result_summary
version
created_at
updated_at
completed_at
```

### Todo

Todos may be a task subtype or a separate lightweight table:

```text
id
workspace_id
creator_tile_id
assignee_tile_id
title
description
status
priority
due_at
created_at
completed_at
```

### ObjectiveVersion

```text
id
workspace_id
tile_id
version
markdown
rules_json
generated_by
created_at
```

### SkillAssignment

```text
id
tile_id
skill_key
source
enabled
metadata_json
created_at
updated_at
```

### ContextAttachment

```text
id
tile_id
kind
label
uri
content_hash
metadata_json
created_at
updated_at
```

### CanvasCommand

```text
id
workspace_id
requester_tile_id
target_tile_id
kind
payload_json
status
created_at
delivered_at
completed_at
error
```

### AuditEvent

```text
sequence
workspace_id
actor_type
actor_id
tile_id
event_type
entity_type
entity_id
correlation_id
payload_json
created_at
```

## 3. Tile state machine

```text
offline ──register──► idle
idle ──start──► working
working ──dependency──► waiting
working ──problem──► blocked
working ──pause──► paused
working ──complete──► done
working ──failure──► error
waiting/blocked/paused/error ──resume──► working
done ──new task──► working
any online state ──heartbeat timeout──► offline
```

The service should allow state correction by the workspace owner while keeping
the audit trail.

## 4. Task state machine

```text
open → assigned → in_progress → review → done
                  │    │
                  │    ├──► paused
                  │    └──► blocked
                  └────────► cancelled
```

Invalid transitions return `CONTEXT_INVALID_TRANSITION`.

## 5. Conflict derivation

Conflicts are computed from live claims rather than persisted as the source of
truth. A conflict notification contains:

```json
{
  "path": "engine/world/30-ui-boot-wiring.js",
  "claimants": [
    {"tile_id": "tile-a", "mode": "edit"},
    {"tile_id": "tile-b", "mode": "edit"}
  ],
  "severity": "warning",
  "recommended_action": "coordinate"
}
```

## 6. Virtual historical files

For compatibility, generate views:

### `objective.md`

- objective title;
- available Skills/Commands;
- communication protocol;
- tile channel;
- rules;
- generated timestamp.

### `skills.json`

```json
{
  "enabled": [],
  "disabled": []
}
```

### `state.json`

```json
{
  "tasks": [],
  "paused": false
}
```

### `peers.md`

- connected tile type and ID;
- available tools;
- generated-link-change notice.

## 7. Retention

Defaults:

- active tile state: indefinite while workspace exists;
- messages: 30 days;
- audit events: 90 days or configurable;
- completed todos: 30 days;
- file claims: remove 24 hours after release;
- objective versions: retain latest 50 per tile;
- canvas commands: 14 days.

Exports should optionally include all history.

## 8. Migration sequence

1. workspace + tile;
2. links + claims;
3. messages;
4. tasks + todos;
5. objectives + skills + attachments;
6. commands + events;
7. indexes and retention jobs;
8. compatibility import from `.contex/tile-*`.

