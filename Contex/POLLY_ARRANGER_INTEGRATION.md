# Polly Arranger Integration Design

## 1. Purpose

Expose Polly Arranger's headless production line through Contex so CodeSurf,
terminal agents, and humans can observe and coordinate Polly runs without making
Contex the source of truth for Polly.

Polly remains responsible for orchestration:

- backlog state;
- item transitions;
- vendor routing;
- worktree creation;
- implement/review/merge execution;
- registry persistence.

Contex adds a coordination layer:

- live status and task views;
- human-attention notifications;
- optional chat/message routing around Polly items;
- file-claim and worktree visibility;
- CodeSurf canvas commands for monitoring or intervention.

## 2. Non-goals

- Do not replace `.polly/registry.json`.
- Do not make Contex required for `polly run` or `polly daemon`.
- Do not let CodeSurf become Polly's scheduler.
- Do not mutate Polly registry state from Contex in the first implementation.
- Do not enforce file locks. Claims remain advisory.
- Do not expose model provider credentials, Contex bearer tokens, or agent
  subprocess environment through browser APIs.

## 3. Integration modes

### 3.1 Observe-only MVP

Polly pushes snapshots and transition events into Contex. CodeSurf can display
tasks, claims, run state, and human-attention events. Contex never tells Polly
what to do.

This mode should ship first.

### 3.2 Assisted-operation mode

CodeSurf can send structured operator requests to Polly through Contex messages
or commands, for example:

- pause item;
- add note;
- mark human decision;
- request rerun of gates;
- create a document or terminal tile for investigation.

Polly remains the only process that applies the request to its registry.

### 3.3 Full control mode

Contex accepts validated commands that Polly consumes as an input queue. This is
out of scope until the observe-only path is stable.

## 4. Identity model

Polly integration introduces a small set of deterministic Contex IDs.

```text
polly:{registryHash}                         integration root
polly:{registryHash}:daemon                  Polly daemon/process tile
polly:{registryHash}:item:{itemId}           item task/tile identity
polly:{registryHash}:impl:{itemId}           optional implementer worker tile
polly:{registryHash}:review:{itemId}         optional reviewer worker tile
```

`registryHash` should be a short stable hash of the absolute registry path. It
prevents collisions when multiple Polly registries are connected to the same
Contex server.

The first release may only create one daemon tile plus Contex tasks for each
item. Worker tiles are useful later when CodeSurf wants a richer visual canvas.

## 5. Polly to Contex mapping

### 5.1 Registry

Polly registry maps to a Contex workspace-level integration record.

| Polly field | Contex representation |
| --- | --- |
| `registryPath` | integration metadata |
| `repoPath` | workspace `repository_path` or metadata |
| `policy.concurrency` | integration metadata |
| `policy.merge` | integration metadata |
| `vendors` | integration metadata and daemon tile progress |

Contex does not need a new table for the MVP if this metadata can live in tile
or task metadata. A later version may add an `integration` table for query speed
and import/export clarity.

### 5.2 Item

Each Polly item maps to one Contex task.

| Polly field | Contex task field |
| --- | --- |
| `id` | metadata `polly_item_id` |
| `title` | `title` |
| `spec` | `description` or context attachment |
| `status` | normalized `status` |
| `implementer` | metadata `implementer` |
| `reviewer` | metadata `reviewer` |
| `worktree` | metadata `worktree` and file claims |
| `branch` | metadata `branch` |
| `pr` | attachment or metadata `pr` |
| `blockedOn` | `blocker` |
| `notes` | task history/audit payload |

Recommended metadata shape:

```json
{
  "source": "polly",
  "registry_path": "/repo/.polly/registry.json",
  "polly_item_id": "p12",
  "polly_status": "IN_REVIEW",
  "implementer": "claude_code",
  "reviewer": "codex",
  "worktree": ".worktrees/p12-settings",
  "branch": "polly/p12-settings",
  "pr": 51,
  "wave": "wave-2"
}
```

### 5.3 Status mapping

| Polly status | Contex task status | Contex tile status |
| --- | --- | --- |
| `PLANNED` | `open` | `idle` |
| `BUILDING` | `in_progress` | `working` |
| `FIXING` | `in_progress` | `working` |
| `IN_REVIEW` | `review` | `working` |
| `RE_REVIEW` | `review` | `working` |
| `BLOCKED` | `blocked` | `blocked` |
| `READY_FOR_HUMAN_MERGE` | `paused` | `waiting` |
| `MERGED` | `done` | `done` |
| `ABANDONED` | `cancelled` | `done` |
| failed/error states | `blocked` or `paused` | `error` |

Contex should preserve the original Polly status in metadata even when it maps
to a coarser Contex status.

### 5.4 Worktrees and file claims

Polly worktrees reduce collisions by isolating edits. Contex claims are still
useful for visibility:

- claim the worktree root as `edit`;
- claim files changed by the item as `edit` once available from Git status;
- mark claims with `section: "polly:<itemId>"`;
- expire or release claims when the item reaches `MERGED`, `ABANDONED`, or
  another terminal state.

Claims should be advisory and should not block Polly scheduling in the MVP.

## 6. MCP API additions

The MVP can be implemented with existing tools:

- `peer_set_state`;
- `create_task`;
- `update_task`;
- `pause_task`;
- `list_tasks`;
- `list_file_claims`;
- `peer_send_message`;
- `notify`;
- `canvas_create_tile`;
- `canvas_highlight`.

However, dedicated integration tools would reduce adapter complexity and improve
idempotency.

### 6.1 `polly_sync_snapshot`

Synchronize the current registry snapshot into Contex.

```json
{
  "workspace_id": "ws_1",
  "registry_path": "/repo/.polly/registry.json",
  "repo_path": "/repo",
  "policy": {
    "concurrency": 3,
    "merge": "human"
  },
  "vendors": ["claude_code", "codex"],
  "items": [
    {
      "id": "p12",
      "title": "Add settings panel",
      "spec": "Build the settings panel...",
      "status": "IN_REVIEW",
      "implementer": "claude_code",
      "reviewer": "codex",
      "worktree": ".worktrees/p12-settings",
      "branch": "polly/p12-settings",
      "pr": 51,
      "blockedOn": null,
      "notes": []
    }
  ],
  "idempotency_key": "polly:/repo/.polly/registry.json:rev:42"
}
```

Expected behavior:

1. upsert the daemon tile;
2. upsert one task per item;
3. update task metadata and status;
4. emit task-change notifications only for changed items;
5. release stale claims for missing or terminal items;
6. write audit events with `source: "polly"`.

### 6.2 `polly_record_transition`

Record one item transition without sending the full registry.

```json
{
  "workspace_id": "ws_1",
  "registry_path": "/repo/.polly/registry.json",
  "item_id": "p12",
  "from": "BUILDING",
  "to": "IN_REVIEW",
  "summary": "Opened PR #51",
  "metadata": {
    "pr": 51,
    "branch": "polly/p12-settings"
  },
  "idempotency_key": "polly:p12:transition:12"
}
```

This tool is optional if `polly_sync_snapshot` is called after every tick.

### 6.3 `polly_request_action`

Create a request for Polly to consume. This is for assisted-operation mode, not
the MVP.

```json
{
  "workspace_id": "ws_1",
  "registry_path": "/repo/.polly/registry.json",
  "item_id": "p12",
  "action": "add_note",
  "reason": "Human approved retry after fixing tests",
  "payload": {
    "note": "Retry gates after dependency install."
  }
}
```

Contex records the request and notifies Polly. Polly must explicitly accept or
reject it.

## 7. Resources

Add read-only resources for monitoring:

```text
context://workspace/{workspaceId}/polly
context://workspace/{workspaceId}/polly/{registryHash}
context://workspace/{workspaceId}/polly/{registryHash}/items
context://workspace/{workspaceId}/polly/{registryHash}/item/{itemId}
```

Resource content should be derived from existing task/tile/audit rows where
possible. Avoid duplicating the registry as a second database.

## 8. Notifications

Emit existing task notifications for ordinary changes. Add Polly-specific
metadata rather than new notification names unless the UI needs them.

Important events:

- item entered `BLOCKED`;
- item entered `READY_FOR_HUMAN_MERGE`;
- item merged;
- item failed gates;
- review produced blocking findings;
- concurrency is saturated;
- daemon heartbeat missed.

For human-facing events, emit `notifications/context/human_attention` with:

```json
{
  "source": "polly",
  "registry_path": "/repo/.polly/registry.json",
  "item_id": "p12",
  "tile_id": "polly:abc123:item:p12",
  "text": "p12 is ready for human merge."
}
```

## 9. Polly adapter design

Polly should gain an optional Contex adapter module. Suggested CLI flags:

```text
polly daemon --repo /repo --contex-url http://127.0.0.1:12345/mcp \
  --contex-token env:CONTEX_TOKEN --contex-workspace ws_1
```

Environment fallback:

```text
CONTEX_URL
CONTEX_TOKEN
CONTEX_WORKSPACE
POLLY_CONTEX_SYNC=1
```

Recommended Polly-side lifecycle:

1. on daemon start, connect to Contex if configured;
2. register daemon tile with `peer_set_state`;
3. after every registry save, call `polly_sync_snapshot`;
4. on transition to blocked or ready-for-human, send human attention;
5. on shutdown, mark daemon tile `offline` or `done`;
6. on Contex failure, log and continue headless.

The adapter should use a bounded retry queue. It must never block the core Polly
state machine indefinitely.

## 10. CodeSurf display plan

CodeSurf can initially consume the integration through existing status tiles:

- task list shows Polly items;
- claim list shows worktree/file claims;
- human attention highlights the item tile;
- document tiles can hold specs or review findings;
- chat tiles can discuss a Polly item.

Later, CodeSurf can render a dedicated Polly board:

```text
Backlog -> Building -> Review -> Blocked -> Ready -> Merged
```

This board should still read Contex resources, not Polly registry files directly.

## 11. Security

- Contex tokens remain server-side.
- Browser APIs must not receive the Polly adapter bearer token.
- Registry paths may reveal local filesystem layout; expose them only to local
  clients and redact in exported bundles unless explicitly requested.
- Provider/API keys must never be included in task metadata, notes, audit
  payloads, or CodeSurf-visible attachments.
- Assisted-operation commands require a scoped token such as `polly:request`.
- Destructive actions, including merge, abort, or worktree removal, must require
  Polly-side confirmation in early versions.

## 12. Failure handling

| Failure | Behavior |
| --- | --- |
| Contex offline | Polly continues headless and logs sync failure |
| Contex restarts | Polly reconnects and sends a full snapshot |
| duplicate snapshot | idempotency key prevents duplicate audit noise |
| stale CodeSurf view | next snapshot refreshes task status |
| Polly crashes | Contex marks daemon tile offline after heartbeat timeout |
| registry manually edited | next snapshot reconciles task metadata |
| task missing in Contex | snapshot recreates it |
| item removed from registry | Contex marks corresponding task cancelled or stale |

## 13. Implementation phases

Recommended delivery plan:

1. **Contract and tests.** Add Polly registry fixtures, status mapping tests,
   idempotency expectations, and the shape of the snapshot API before touching
   persistence.
2. **Contex observe-only MVP.** Implement `polly_sync_snapshot`, map Polly items
   to Contex tasks, reuse existing task/claim/audit/notification storage, and
   emit human-attention notifications for blocked or ready-for-merge items.
3. **Polly optional adapter.** Add Contex CLI flags/environment fallback to
   Polly, register the daemon tile, sync after each tick or registry save, and
   continue headless when Contex is unavailable.
4. **CodeSurf visualization.** Reuse status tiles first, then optionally add a
   dedicated Polly board once the data contract is stable.
5. **Assisted operation.** Add request actions such as pause, add note, or rerun
   gates. Polly consumes and accepts/rejects requests; destructive actions still
   require Polly-side or human confirmation.

Current implementation status:

- Step 1 is implemented: registry fixture, status mapping, deterministic IDs,
  and task-draft contract tests exist.
- Step 2 is implemented: Contex exposes `polly_sync_snapshot`, projects Polly
  items into tasks/tiles/file claims, emits human-attention notifications, and
  renders read-only `context://workspace/{id}/polly...` resources. It remains
  observe-only and does not mutate Polly registries.
- Step 3 is started: PollyArranger has an optional Contex MCP adapter, CLI flags
  and environment fallback, sync-on-save store wrapping for `run`, `daemon`, and
  `add`, and best-effort failure handling that keeps Polly running headless.
- Step 4 is started: CodeSurf status views now recognize `polly:*` task
  channels, expose a normalized Polly summary from `/api/contex/status-view`,
  and render Polly items in a dedicated observe-only panel.
- Step 5 is started: Contex records assisted-operation requests via
  `polly_request_action`, exposes them for Polly consumption, records
  accept/reject/apply results, and CodeSurf can queue safe observe-only requests
  such as pause or gate rerun without mutating Polly registries directly.

### Phase A — Contract and tests

- Add snapshot fixture based on `PollyArranger/examples/registry.example.json`.
- Add unit tests for status mapping.
- Add integration tests for task upsert idempotency.
- Add resource rendering tests.

### Phase B — Contex MVP tools

- Implement `polly_sync_snapshot`.
- Reuse existing task and claim storage.
- Add audit events with `source: "polly"`.
- Add human-attention emission for blocked and ready states.

### Phase C — Polly optional adapter

- Add Polly CLI flags and environment fallback.
- Register daemon tile.
- Sync after every tick or registry save.
- Continue headless on failure.

### Phase D — CodeSurf visibility

- Ensure status tile renders Polly metadata cleanly.
- Add item focus/highlight behavior.
- Optionally add a Polly board tile.

### Phase E — Assisted operation

- Add request queue.
- Add Polly-side accept/reject handling.
- Add scoped permissions.
- Add audit trail for human decisions.

## 14. Acceptance criteria

Observe-only MVP is complete when:

- `polly daemon` can run without Contex exactly as before;
- with Contex enabled, every Polly item appears as a Contex task;
- item status changes are visible in CodeSurf without page reload;
- `BLOCKED` and `READY_FOR_HUMAN_MERGE` emit human-attention notifications;
- worktree and changed-file claims appear in the status view;
- Contex restart followed by Polly snapshot recovers the view;
- Polly tests pass without requiring a Contex server;
- Contex tests cover idempotent snapshot sync.

## 15. Open questions

- Should worker tiles be created for implementer/reviewer agents in the MVP, or
  are tasks enough?
- Should Contex store full Polly specs as task descriptions, or attach them as
  separate context resources to keep task rows small?
- How should Polly expose changed-file lists before a PR exists?
- Should human merge approval be represented as a Contex task transition or as a
  Polly-specific request action?
- Should registry path hashing be stable across machines for exported bundles,
  or intentionally machine-local?
