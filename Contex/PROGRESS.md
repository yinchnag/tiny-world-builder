# Contex — build progress

> Rebuild of the **Contex** MCP coordination service (the local-first backend
> under the CodeSurf canvas) from the recovered traces in this repo. Same
> "archaeological rebuild" method as [PollyArranger](../PollyArranger/PROGRESS.md):
> read this file first, update it last, one phase per session.

Design docs live alongside this file (`README.md`, `FUNCTIONAL_SPEC.md`,
`DATA_MODEL.md`, `MCP_API.md`, `EVIDENCE.md`, `RECOVERED_ARTIFACTS.md`,
`DEVELOPMENT_PLAN.md`, `WORK_SCHEDULE.md`). Implementation is under `src/`,
tests under `test/`.

## How to run

```bash
cd Contex
npm test                 # node --experimental-sqlite --test  (all offline, in-memory)
npm run serve            # boots on 127.0.0.1:<dynamic>, prints url+token on stderr
```

Requires Node >= 22.5 (built-in `node:sqlite`). **Zero runtime dependencies.**

## Status

- [x] **Round 1 — Contex core closed loop**
- [x] **Phase 1 — real MCP Streamable HTTP transport** (sessions + SSE notifications)
- [x] **Phase 2 — workspace lifecycle + MCP resource views** (`context://` reads)
- [x] **Phase 3 — canvas links + peer discovery** (directed tool-flow, opt-in workspace discovery)
- [x] **Phase 4 — messaging + notifications** (chat adapters, notify, priority, retention, inbox resource)
- [x] **Phase 5 — tasks + first-gen task tools** (state machine, create/update/pause_task, tasks resource)
- [x] **Phase 6 — file claims + collision prevention** (path safety, stale/expiry, owner override)
- [x] **Phase 7 — objectives, skills, context** (versioned objectives + reload signaling, get_context)
- [x] **Phase 8 — canvas command bus** (queue + lifecycle, canvas_create_tile, terminal input, consumer ops)
- [x] **Phase 9 — audit, replay, and export** (correlation IDs, workspace export/import, secret redaction, audit feed, `context://…/audit` resource)
- [x] **Phase 10 — CodeSurf integration hardening** (SSE Last-Event-ID replay, ring buffer, `/events` owner SSE, SSE backpressure, `/version` compatibility fields, comprehensive E2E restart test)
- [x] **Phase 11 — Operational hardening** (structured JSON logging with redaction, per-IP rate limiting + 429, retention scheduler, `GET /metrics`, TLS/HTTPS, CLI `--cert`/`--key`/`--rate-limit`/`--retention-interval`/`--log-level` flags)
- [x] **Phase 12 — Scoped tokens + legacy import + workspace SSE filter** (createTokenStore with issue/revoke/list/expiry; adminOnly tools; 4 new MCP tools: issue_client_token, revoke_client_token, list_client_tokens, import_tile_dir; `.contex/tile-*/` legacy import; workspace_id in notifications; `GET /events?workspace_id=` filter)
- [x] **Agent Platform Upgrade Phase 1 — documentation and protocol boundary** (`AGENT_PLATFORM_UPGRADE.md` + `AGENT_PLATFORM_PHASE1.md`; Contex is the platform, CodeSurf is the visual orchestration layer, runtime adapters are replaceable bridges)
- [x] **Agent Platform Upgrade Phase 2 — Contex Agent semantic API** (`agent_register`, `agent_update_state`, `agent_list`, `agent_send_message`, `agent_read_messages` backed by existing tile/message/link primitives; directed message flow enforced)
- [x] **Agent Platform Upgrade Phase 3 — Codex runtime adapter generalization** (`CodeSurf/scripts/agent-runtime-codex.mjs`, profile/role/model/system prompt env, old `codex-chat-agent.mjs` compatibility)
- [x] **Agent Platform Upgrade Phase 4 — CodeSurf Create Agent UI** (`+ Agent` dialog, Agent tile type, codex runtime path endpoint, per-Agent env/profile/autostart wiring)
- [x] **Agent Platform Upgrade Phase 5 — Agent collaboration semantics** (`agent_claim_task`, `agent_complete_task`, `agent_request_handoff`, `agent_report`, `agent_broadcast`; coordinator/planner/worker/reviewer chains over existing task/message/link primitives)
- [x] **Agent Platform Upgrade Phase 6 — Observability and audit timelines** (`context://workspace/{id}/timeline`, `context://tile/{id}/timeline`, `get_workspace_timeline`, `get_agent_timeline`; normalized status/message/task timeline over audit events)

## Round 1 — what shipped

The headless coordination loop the recovered `.claude/CLAUDE.md` protocol
describes, proven without a canvas:

- **Storage** (`src/db.mjs`): SQLite via `node:sqlite`, WAL + foreign keys,
  normalized current-state tables + append-only `audit_event`. Full DATA_MODEL.md
  entity set is created (workspace, tile, tile_link, file_claim, message, todo,
  audit_event, idempotency).
- **Tiles / presence** (`src/domain/tiles.mjs`): `peer_set_state` with the tile
  **state machine**, **optimistic concurrency** (`expected_version`), file-claim
  sync from `files[]`, and **heartbeat-timeout → offline** derivation on read.
- **Peer graph** (`src/domain/peers.mjs`, `links.mjs`): `peer_get_state` returns
  self + **linked peers** (discovery follows canvas edges only) with each peer's
  **type-derived tools**, plus **file-conflict derivation** (read/read silent,
  read/edit info, edit/edit warning, exclusive blocking) computed live, never
  persisted, never touching files.
- **Messaging / todos** (`src/domain/messaging.mjs`): link-gated direct messages
  persisted before delivery, unread/read/ack, lightweight todo assign/complete.
- **MCP transport** (`src/server.mjs`, `tools.mjs`): bearer-authed JSON-RPC over
  HTTP `POST /mcp` (`initialize`, `tools/list`, `tools/call`) + unauthenticated
  `/health`. Business errors surface as MCP `isError` results with the stable
  `CONTEXT_*` code; idempotency keys make repeated mutations no-ops.
- **CLI** (`src/cli.mjs`): `contex serve` opens the db, ensures a default
  workspace, mints an **in-memory** bearer token, binds loopback, and emits the
  launcher handshake on stderr.

**Tests: 22 passing** (`tiles`, `peers`, `messaging`, `server` E2E with two mock
MCP agents over real HTTP, `restart` recovery). Verified: two agents register →
link → discover peers/tools → declare claims → message; auth rejection;
idempotency; SQLite survives a restart.

## Round 1 — security invariants held

EVIDENCE.md flagged that live bearer tokens once leaked into version control.
This build: token is generated/held **in memory only**, printed solely on
stderr, and `.gitignore` excludes `*.db`. The loopback bind (`127.0.0.1`) is the
default; remote mode is a deliberate non-goal for now.

## Phase 1 — real MCP Streamable HTTP transport (this session)

Replaced the Round-1 JSON-RPC-over-POST subset with a spec-compliant Streamable
HTTP transport (`src/mcp-transport.mjs`), still **zero-dependency** (hand-rolled,
not the official SDK):

- **Session lifecycle**: `initialize` mints a session returned in the
  `Mcp-Session-Id` header; subsequent requests carry it; an unknown/expired
  session is rejected `404`; `DELETE /mcp` terminates it. Protocol version is
  negotiated (`2025-06-18` / `2025-03-26` / `2024-11-05`).
- **Server→client notifications**: `GET /mcp` (Accept: text/event-stream) opens
  an SSE stream; the facade's event bus (`contex.events`) forwards
  `notifications/context/*` (tile_state_changed, peer_link_changed,
  message_received, todo_assigned, file_conflict) onto every open stream.
- **POST**: single message or batch; requests get an `application/json`
  response, pure notifications/responses get `202`. Business errors stay MCP
  `isError` results; protocol faults use HTTP/JSON-RPC errors.
- Sessionless POST is still tolerated for ephemeral/simple callers (curl, the
  Round-1 `MockAgent`), so older tests keep passing.

**Tests: 28 passing** (+7 transport: handshake/session, 202 on initialized, SSE
push received by a client, Accept/session enforcement on GET, 404 on bad
session, DELETE, full lifecycle).

**Not verified here:** an actual Claude/Codex MCP client attaching over a real
`.mcp.json` entry — the suite drives a spec-following client we wrote, not the
vendor clients. That last-mile check is a user step (config below).

### Attach a real client

```jsonc
// .mcp.json  (token + url come from the `contex serve` stderr handshake)
{ "mcpServers": { "contex": {
  "type": "http",
  "url": "http://127.0.0.1:<port>/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}}}
```

## Phase 2 — workspace lifecycle + MCP resource views (this session)

Most of DEVELOPMENT_PLAN.md's Phase 2 (tile register/update/get, state machine,
optimistic version, heartbeat→offline, `peer_set_state`/`peer_get_state`) already
shipped in Round 1 and met the exit criterion. This session closed the gaps:

- **MCP resources** (`src/resources.mjs`) — the other half of MCP, alongside
  Phase 1's tools. `resources/list` + `resources/read` with `context://` URIs:
  `workspace/{id}` (metadata + active tile count), `workspace/{id}/graph`
  (tiles as nodes, links as edges), `tile/{id}/state` (status + claims), and
  `tile/{id}/peers` rendered as the historical **peers.md** markdown. Advertised
  via the `resources` capability at initialize.
- **Workspace lifecycle** (`domain/workspace.mjs`) — `list` (incl. archived) +
  `archive`; archiving back down to one restores the sole-default resolution.
- **Reconnect semantics** — a new `client_instance_id` on an existing tile
  preserves prior state and emits a `tile_reconnected` audit event.
- **done → new-task** transition test (DATA_MODEL §3).

**Tests: 39 passing** (+11: resources list/read for each view + over-the-wire,
workspace create/list/archive, reconnect, done→new-task).

Still deferred to their phases: `inbox` / `tasks` / `audit` / `objective` /
`skills` resources (Phases 4/5/7/9), and resource `subscribe`.

## Phase 3 — canvas links + peer discovery (this session)

Link CRUD, capability filtering, linked-peer aggregation, virtual peers.md, and
graph-change notifications were already in place (Round 1 + Phase 1/2). This
session added the two missing behaviors and the test coverage Phase 3 calls for:

- **Directed tool flow** (`domain/links.mjs` `canActOn`): visibility is
  undirected (both ends see each other), but a peer's `available_tools` are
  listed only when *this* tile may act on it — an undirected link allows both
  ways, a directed `source→target` link only one way. (FUNCTIONAL_SPEC.md:
  directedness changes which tools flow which way, not visibility.)
- **Opt-in workspace discovery** (`domain/workspace.mjs`
  `setWorkspaceDiscovery`): `include_workspace` now throws
  `CONTEXT_SCOPE_DENIED` until the workspace enables it; default discovery stays
  link-only.

**Tests: 44 passing** (+5: link deletion hides peers, terminal↔terminal
two-way tools, directed one-way tools + two-way visibility, offline peers hidden
by default / shown with include_offline, and a `peer_link_changed` notification
received over the SSE stream).

## Phase 4 — messaging + notifications (this session)

Persistent inbox, direct messages, acknowledgement, unread reads, reply/
correlation ids, and the notification stream were already in place (Round 1 +
Phase 1). This session added the chat adapters and the remaining behaviors:

- **Chat adapters**: `chat_send_message` (human-readable message; target must be
  a chat tile, still link-gated) and `chat_acknowledge` (only the recipient may
  ack; stamps acknowledged_at).
- **`notify`** tool: workspace notification; `level: 'human_attention'` raises a
  `notifications/context/human_attention` SSE notification (other levels →
  `notice`), and every notify is audited.
- **Priority ordering** (`urgent→high→normal→low`, then chronological) and
  **offset pagination** in `peer_read_messages`.
- **Retention**: `purgeExpiredMessages` drops messages past the window
  (default 30 days, DATA_MODEL §7).
- **Inbox resource**: `context://tile/{id}/inbox` (the Phase-2-deferred view).

Exit criterion met: a terminal agent asks a linked chat tile a question and reads
the reply (covered end-to-end over MCP).

**Tests: 54 passing** (+10: chat send/ack, priority order, offline-then-read,
idempotent duplicate send, notify human_attention via SSE, retention purge, inbox
resource, and the terminal↔chat exit scenario).

Still deferred: retention runs on-demand only (no background sweep in `serve`
yet); `tasks` resource + task state machine are Phase 5.

## Phase 5 — tasks + first-gen task tools (this session)

Mostly new work: the `task` entity had no domain logic (only todos existed).

- **`task` table** added to the schema (SCHEMA_VERSION → 2) — DATA_MODEL.md was
  missing it in Round 1; `CREATE TABLE IF NOT EXISTS` picks it up on next open.
- **Task state machine** (`domain/tasks.mjs`): `open → assigned → in_progress →
  review → done`, with `paused`/`blocked`/`cancelled` branches; invalid moves →
  `CONTEXT_INVALID_TRANSITION`, concurrent edits → `CONTEXT_VERSION_CONFLICT`.
  Pause stores the reason as the blocker; resuming clears it; `done` stamps
  `completed_at`.
- **First-gen tools**: `create_task` (channel = a tile id or the workspace),
  `update_task`, `pause_task`. The historical `mcp__contex__` prefix is applied
  by the MCP client, so server-side names stay bare.
- **Per-channel views** (`listTasks` channel filter), **task_changed**
  notifications, and **`importTaskState`** (recovered `state.json` → tasks).
- **Tasks resource**: `context://workspace/{id}/tasks` ({ tasks, todos }).

Exit criterion met: a recovered `state.json` imports and is represented through
the tasks resource.

**Tests: 64 passing** (+10: happy-path lifecycle, invalid transitions,
optimistic concurrency, pause/resume blocker, assign-to-offline-tile, per-channel
views, state.json import, tasks resource, and create_task → task_changed SSE).

## Phase 6 — file claims + collision prevention (this session)

Claim publication, read/edit/exclusive modes, conflict derivation, and conflict
notifications already shipped (Round 1 + Phase 1). This session added the
security + lifecycle pieces:

- **Path safety** (`domain/claims.mjs` `normalizeClaimPath`): claim paths are
  normalized relative to the workspace `repository_path`; `../` traversal and
  absolute paths outside the root are rejected (`CONTEXT_BAD_REQUEST`).
  Validated up-front in `peer_set_state` so an escaping path rejects the whole
  update with no partial claim. Contex still never reads file contents.
- **Stale-claim expiry**: a claim only counts toward a conflict when its owning
  tile is online and the claim's `expires_at` (optional, per `files[]` entry)
  hasn't passed — offline/expired claims no longer block. `purgeExpiredClaims`
  releases lapsed claims.
- **Owner override**: `releaseClaim({ tile_id, path? })` releases a tile's
  claim(s) and emits a `file_conflict` update; resolves the conflict.

**Tests: 71 passing** (+7: path normalization incl. Windows paths, traversal/
out-of-root rejection, escaping path leaves no claim, normalized storage,
offline-claim-is-stale, expiry + purge, conflict resolves after release).

Exit criterion already held (two linked editors get a warning before writing);
this phase hardens the safety around it.

## Phase 7 — objectives, skills, context (this session)

New work — these entities had no schema/logic. Added `objective_version`,
`objective_ack`, `skill_assignment`, `context_attachment` tables
(SCHEMA_VERSION → 3).

- **Versioned objectives** (`domain/objectives.mjs`): each `set_objective` stores
  an immutable new version; the current one is never overwritten. A tile needs a
  reload while latest version > its acknowledged version.
- **Reload signaling + ack**: `set_objective` emits
  `notifications/context/objective_reload_required`; `reload_objective` fetches
  the latest and acknowledges its version. Acking an older version is reported as
  `stale` (reload still required).
- **Skills** (`domain/skills.mjs`): per-tile enable/disable (upsert), rendered as
  the historical `skills.json` ({ enabled, disabled }).
- **Context attachments** (`domain/attachments.mjs`): references (kind/label/uri/
  hash), never inline content.
- **`get_context`**: objective + skills + peers + tasks(channel) + attachment
  references + reload_required, in one call.
- **Virtual files as resources**: `context://tile/{id}/objective` (objective.md)
  and `/skills` (skills.json) — the Phase-2-deferred views.

Tools: `set_objective`, `set_skill`, `add_context_attachment`, `get_context`,
`reload_objective`. Exit criterion met: CodeSurf alters a tile objective and the
running agent is prompted to reload (covered end-to-end over MCP).

**Tests: 77 passing** (+6: versioning + reload-required, stale ack, skills
enable/disable, get_context assembly, objective.md/skills.json resources, and the
set_objective → objective_reload_required → reload_objective SSE flow).

Deferred: optional `.contex/tile-*` import/export (Phase 7 stretch); exact
byte-match of historical objective.md fixtures awaits Phase 0 fixtures.

## Phase 8 — canvas command bus (this session)

New work — the bridge CodeSurf needs. Added the `canvas_command` table
(SCHEMA_VERSION → 4) and a queue + lifecycle (`domain/commands.mjs`):
`accepted → delivered → completed | failed | expired`.

- **Agent-facing**: `canvas_create_tile`, `terminal_send_input`, `canvas_focus`,
  `canvas_highlight`, `canvas_connect` — each enqueues a command and emits
  `canvas_command`.
- **Consumer-facing** (CodeSurf/owner): `canvas_next_commands` (pull pending,
  mark delivered — at-least-once) and `canvas_complete_command` (report result/
  error, emits `canvas_command_result`). Completion is idempotent.
- **Safety**: `terminal_send_input` requires the caller to be linked
  (`canActOn`) AND the target to advertise the `terminal_input` capability;
  control sequences are destructive and need `confirm: true`. Every command is
  audited.
- **Offline + timeout**: commands sit `accepted` until a consumer drains them;
  `expireStaleCommands` expires ones never finished within the window.

Exit criterion met: an agent calls `canvas_create_tile`, the consumer fulfills
it, and the agent receives the new tile id via `canvas_command_result`
(covered end-to-end over MCP).

**Tests: 84 passing** (+7: create→fulfill→id, offline queue, at-least-once +
idempotent completion, invalid-type reject + consumer fail, terminal-input
permission/capability/control rules, command expiry, and the SSE exit flow).

## Deliberate simplifications (revisit in later phases)

- SSE streams have **no resumability/replay** (Last-Event-ID is emitted but not
  honored on reconnect); POST never streams its response as SSE (single JSON
  body, which the spec allows).
- **Single owner token, no scopes.** `workspace:read` / `tile:state` /
  `message:send` etc. are not enforced yet.
- **No rate limiting** (limits are documented in MCP_API.md §7, not wired).
- Tasks, objectives/skills, canvas command bus, and first-gen `create_task`
  aliases are not implemented — only the `peer_*` second-generation surface
  plus `link_tiles`/`unlink_tiles`.
- `link_tiles` stands in for CodeSurf drawing canvas edges (headless wiring).

## Phase 9 — audit, replay, and export (this session)

The `audit_event` table and `audit()` writer already existed; this phase wired
them up completely and built the inspection/export surface.

- **Correlation IDs**: every `callTool` invocation now auto-generates a
  `call_<uuid>` correlation id (or accepts one from the caller's args) and
  threads it into all synchronous domain audit calls via `_setCallCtx` /
  `_clearCallCtx` on the facade. JS is single-threaded and all domain functions
  are synchronous, so no concurrency issue. Audit events from the same MCP tool
  call now share a traceable id.
- **Audit coverage gap fixed**: `domain/claims.mjs` `releaseClaim` was the one
  domain mutation that didn't write an audit event. Now writes `claim_released`
  (with workspace_id looked up from the tile row) when claims are actually
  removed.
- **Audit feed** (`store.mjs` `listAuditFeed`): forward-scanning paginated read
  (`WHERE sequence > since_sequence ORDER BY sequence ASC`) for Workspace Memory
  event consumers. `listAudit` also gained safe payload parsing: a corrupted
  `payload_json` yields `{ _raw, _error: 'parse_failed' }` instead of throwing.
- **Workspace export** (`domain/export.mjs`):
  - `exportWorkspace(db, workspaceId, opts)` — snapshots all entities (workspace,
    tiles, links, messages, tasks, todos, objectives, objective_acks, skills,
    attachments, claims, last-500 audit events) into a `contex-export/1` JSON
    bundle after running `redactSecrets`.
  - `importWorkspace(db, bundle)` — bulk-inserts the bundle into an existing db
    (`INSERT OR IGNORE`) for round-trip restore.
  - `redactSecrets(obj)` — deep-scans all object keys against a sensitive-name
    RE (`token|password|secret|api_key|…`) and replaces matching values with
    `"[REDACTED]"`.
- **MCP tools** (`tools.mjs`): `export_workspace` (returns the full bundle) and
  `get_audit_log` (paginated forward feed via `since_sequence`).
- **Audit resource** (`resources.mjs`): `context://workspace/{id}/audit` — last
  100 events in forward order; listed in `resources/list`.

Exit criterion met: workspace coordination state can be exported to a portable
bundle, the bundle round-trips cleanly through import into a fresh db, and the
audit log is accessible both as an MCP resource and via the `get_audit_log` tool.

**Tests: 95 passing** (+11 audit tests: tile_state_changed event written,
message_sent event written, task_created event written, correlation_id auto-
generated and threaded, caller-supplied correlation_id honored, export/import
round trip, secret redaction structure, no raw token in export, damaged
payload_json recovered, since_sequence pagination, audit MCP resource readable).

## Phase 10 — CodeSurf integration hardening (this session)

- **SSE Last-Event-ID replay** (`src/mcp-transport.mjs`): each server instance
  now maintains a monotone global sequence number and a ring buffer of the last
  200 notifications (`createEventRing`). A reconnecting `GET /mcp` client that
  sends `Last-Event-ID: N` receives all buffered events with seq > N before
  switching to live delivery. Per SSE spec, absent `Last-Event-ID` means no
  replay (fresh stream, live events only).
- **SSE backpressure**: `res.write()` return value is checked on every event. If
  the OS write buffer is full (slow consumer), the stream is terminated
  gracefully rather than letting the server buffer grow unbounded.
- **`GET /events` owner SSE endpoint**: bearer-only stream for the CodeSurf
  canvas UI — no MCP session required. Shares the same ring buffer and
  sequence IDs as `GET /mcp` for consistent Last-Event-ID replay across both
  consumer types.
- **Enhanced `/version` response**: `schema_version` (current SQLite
  `PRAGMA user_version`) and `supported_protocols` array are now included
  alongside the existing fields. `protocol` (back-compat) remains.
- **Shared `openEventStream`**: `openNotificationStream` replaced by
  `openEventStream(stampedEvents, ring, req, res)` shared by both `/mcp GET`
  and `/events GET`.
- **Schema migration safety verified**: `CREATE TABLE IF NOT EXISTS` in
  `openDb` already handles all schema upgrades (every version bump only added
  new tables, never new columns). Verified explicitly in `test/integration.test.mjs`.

Exit criterion met: a comprehensive E2E test (`test/integration.test.mjs`) covers
the full 10-step coordination cycle (create workspace, register tiles, link, update
state with file claims, exchange messages, create todo + task, set objective,
restart, verify full recovery) plus Last-Event-ID replay, `/events` auth edge cases,
and schema idempotency.

**Tests: 107 passing** (+12 integration tests: /version fields, /health unchanged,
Last-Event-ID replay (full + partial + absent), /events 401/406/live/shared-ring,
E2E restart recovery 10-step, export/import full cycle, schema idempotency guard).

## Deliberate simplifications (revisit in later phases)

- **POST responses are always single JSON bodies** (not SSE-streamed). The spec
  allows this; only server→client push uses SSE.
- **`/events` sends all notifications** (no per-workspace filter). All current
  notification params omit `workspace_id`, so filtering would require adding it.
  Deferred.
- **Single owner token, no per-client scopes.** `workspace:read` / `tile:state`
  / `message:send` scope granularity is documented in MCP_API.md §7 but not
  enforced. The master token grants full access; scoped client tokens deferred.

## Phase 11 — Operational hardening (this session)

The DEVELOPMENT_PLAN.md Phase 11 describes remote/team mode (PostgreSQL, SSO,
multi-node). Those require runtime deps that conflict with the zero-dep constraint.
This session implements the operational hardening that makes Contex production-ready
for local mode instead:

- **Structured JSON logging** (`src/logger.mjs`, new): one JSON line per event on
  stderr. Fields: `ts`, `level`, `event`, + context. Sensitive keys are
  automatically `[REDACTED]` (`token`, `authorization`, `bearer`, `text`,
  `content`, `markdown`, `payload`, `password`, `secret`, `api_key`). Level
  filtering (`debug`/`info`/`warn`/`error`). `startServer` and `buildRequestListener`
  accept a `logger` option so tests can capture output without touching stderr.
  CLI `--log-level` flag.
- **Per-IP rate limiting** (`src/mcp-transport.mjs`): sliding 60-second window
  per remote IP, configurable via `maxRequestsPerMinute` (0 = disabled). On
  breach: 429 + `Retry-After: 60` header. `/health` and `/version` are exempt
  (unauthenticated launcher probes must always get through). CLI `--rate-limit`.
- **`GET /metrics` endpoint** (`src/mcp-transport.mjs`): unauthenticated
  Prometheus-style counter snapshot. Returns: `workspaces` (active), `tiles`
  (total + online), `messages.unread`, `commands.pending`, `audit.total`,
  `timestamp`. Backed by `getDbMetrics(db)` in `src/store.mjs`.
- **Retention scheduler** (`src/server.mjs`): `startServer` accepts
  `retentionIntervalMs` (default 0 = disabled; CLI default 3 600 000 ms = 1 hour).
  On each tick: `purgeExpiredMessages`, `purgeExpiredClaims`,
  `expireStaleCommands`. Errors are caught and logged (never crash the server).
  `runRetention` exported for direct use in tests.
- **HTTPS / TLS** (`src/server.mjs`): `startServer` accepts `tls: { cert, key }`
  (PEM strings) — switches to `node:https`, zero new deps. URL becomes `https://`.
  CLI `--cert <path> --key <path>` reads the files.
- **CLI hardening** (`src/cli.mjs`): added `--cert`, `--key`, `--rate-limit`,
  `--retention-interval`, `--log-level` flags. `server.shutdown` logged on SIGTERM.
  Startup handshake JSON (`{ event: 'listening', ... }`) unchanged.

Exit criterion met: all operational concerns are addressable via CLI flags; a
running server emits structured logs, enforces rate limits, self-prunes old data,
and exposes a live metrics snapshot — with zero new runtime dependencies.

**Tests: 124 passing** (+17 phase11 tests: JSON log format, level filtering, token
redaction, message-content redaction, server.start log, tool.call log; rate limit
breach 429, Retry-After header, disabled limit, health probe exemption; runRetention
direct purge, scheduled sweep via short interval, error resilience; /metrics shape,
getDbMetrics, archived workspace counting; HTTP vs HTTPS scheme plumbing).

## Agent Platform Upgrade Phase 2 — Contex Agent semantic API (this session)

Phase 2 adds the first semantic Agent Platform API while keeping Contex's storage
model unchanged.

- **Agent domain layer** (`src/domain/agents.mjs`, new): wraps existing
  `tile` + message primitives. `agent_id` is tile-backed; `role` / `runtime`
  are encoded as capability markers (`agent`, `role:<role>`, `runtime:<runtime>`)
  so no migration is required.
- **Facade + tools** (`src/index.mjs`, `src/tools.mjs`): adds
  `agent_register`, `agent_update_state`, `agent_list`, `agent_send_message`,
  and `agent_read_messages`.
- **Directed communication policy** (`src/domain/messaging.mjs`): direct
  messages now respect `canActOn`, so directed links permit source → target
  message flow only while undirected links still allow both directions.
- **Tests** (`test/agents.test.mjs`, new): covers registration, state updates,
  list filters, link-gated inbox delivery, directed link rejection, and MCP tool
  catalog/callTool access.

Exit criterion met: multiple registered Agents can be discovered by role/runtime
and can exchange messages through Contex using the new semantic tools, without
breaking existing peer/chat APIs.

**Tests: 167 passing** (`npm --prefix Contex test`).

## Agent Platform Upgrade Phase 3 — Codex runtime adapter generalization (this session)

Phase 3 lives in CodeSurf and uses Contex's Phase-2 `agent_*` semantic API.

- **New runtime**: `CodeSurf/scripts/agent-runtime-codex.mjs` reads Agent profile
  and env (`AGENT_ID`, `AGENT_TILE_ID`, `AGENT_PROFILE_JSON`, `AGENT_ROLE`,
  `AGENT_MODEL`, `AGENT_SYSTEM_PROMPT`, `AGENT_CWD`) and uses
  `agent_register`, `agent_update_state`, `agent_read_messages`, and
  `agent_send_message`.
- **Backward compatibility**: `CodeSurf/scripts/codex-chat-agent.mjs` remains as
  the old command path and forwards to the new runtime. Legacy `CARD_ID` and
  `CODEX_CHAT_MODEL` still work.
- **Tests**: `CodeSurf/test/agent-runtime-codex.test.mjs` covers config parsing,
  prompt assembly, and the message-handling path through `agent_*` tools.
- **Shared tooling note**: Playwright is installed at `/Users/sking/codeSurf`,
  not globally. This is also recorded in `/Users/sking/.codex/AGENTS.md`.

Exit criterion met: the Codex runtime can be launched under distinct
`AGENT_ID` / role / model / system-prompt profiles while preserving the old chat
bridge command.

**Tests: 83 passing** (`npm --prefix CodeSurf test`).

## Agent Platform Upgrade Phase 4 — CodeSurf Create Agent UI (this session)

Phase 4 lives in CodeSurf and wires users into the Phase-2/3 Agent platform:

- `CodeSurf/public/index.html` adds the `+ Agent` toolbar entry and Create Agent
  dialog.
- `CodeSurf/public/tiles.mjs` adds an `agent` tile type with role/runtime/model
  display and terminal runtime controls.
- `CodeSurf/public/canvas.js` creates Agent tiles with runtime command, cwd,
  profile, env, and auto-start data.
- `CodeSurf/src/server.mjs` exposes `/api/agent-runtimes/codex` and passes
  per-Agent env through terminal start.
- Playwright smoke used the local `/Users/sking/codeSurf` install and verified
  an Agent tile persisted with `AGENT_PROFILE_JSON`, role, model, and the
  Phase-3 runtime command.

**Tests: 85 passing** (`npm --prefix CodeSurf test`).

## Agent Platform Upgrade Phase 5 — Agent collaboration semantics (this session)

Phase 5 adds the collaboration verbs Agents need to coordinate work without
manually driving lower-level task state transitions:

- **Task claim/complete**: `agent_claim_task` assigns open work to an Agent and
  can move assigned work into progress; `agent_complete_task` walks the existing
  task lifecycle through `review` to `done` and records a result summary.
- **Handoff/report**: `agent_request_handoff` moves task ownership and sends an
  ack-required linked message; `agent_report` sends results back and can update
  task `result_summary`.
- **Broadcast**: `agent_broadcast` selects recipients by role/runtime/status/
  capability while preserving existing link-gated delivery. The result reports
  per-recipient delivery/failure rather than bypassing link policy.
- **Facade + MCP tools**: `src/index.mjs` emits `task_changed` and
  `message_received` notifications for these semantic operations; `src/tools.mjs`
  exposes all five new tools.
- **Tests**: `test/agents.test.mjs` covers claim/start, complete, worker →
  reviewer handoff, reviewer → coordinator report, role broadcast with one
  linked and one unlinked recipient, and tool catalog/callTool coverage.

Exit criterion met: a Coordinator/Planner can assign work, a Worker can claim it
and request review, and a Reviewer can report back through Contex using semantic
Agent tools.

**Tests: Contex full suite passing** (`npm --prefix Contex test`).

## Agent Platform Upgrade Phase 6 — Observability and audit timelines (this session)

Phase 6 makes Agent collaboration inspectable without forcing UI/runtime callers
to understand raw audit rows:

- **Timeline aggregation** (`src/store.mjs`): new `listTimeline` maps append-only
  audit events into stable `category`, `summary`, `payload`, and sequence fields.
  It supports workspace-wide timelines and per-Agent/tile filtering.
- **Task replay metadata** (`src/domain/tasks.mjs`): task audit payloads now
  include owner/status/result summary details so handoff/report flows can be
  reconstructed from audit context.
- **Facade + MCP tools** (`src/index.mjs`, `src/tools.mjs`):
  `get_workspace_timeline` and `get_agent_timeline`.
- **MCP resources** (`src/resources.mjs`):
  `context://workspace/{id}/timeline` and `context://tile/{id}/timeline`.
- **Tests** (`test/agents.test.mjs`): covers coordinator/worker/reviewer
  collaboration timeline reconstruction, per-Agent filtering, resources/list,
  resources/read, and MCP tool access.

Exit criterion met: CodeSurf or an Agent runtime can read status/message/task
timelines for a workspace or a single Agent, while Contex still keeps the raw
audit feed available for export/replay.

**Tests: Contex full suite passing** (`npm --prefix Contex test`).

## Agent Platform Upgrade — Human handoff for permission/decision gates (this session)

This slice closes the user-facing requirement that independent Agents can pause
for a human instead of guessing through permission or major-decision boundaries:

- **Contex tool**: `agent_request_human_input` updates the Agent state to
  `waiting`/`blocked`, records the blocker, optionally attaches the blocker to a
  task, audits a `human_attention` notification, and emits the live SSE
  notification for CodeSurf.
- **Tile state machine**: `idle -> waiting/blocked` is now legal so an idle Agent
  can ask for approval before starting risky work.
- **Runtime protocol**: the Codex runtime prompt tells the model to output
  `HUMAN_ATTENTION: <question>` or `HUMAN_ATTENTION[permission]: <question>`
  when human input is required.
- **Runtime behavior**: `CodeSurf/scripts/agent-runtime-codex.mjs` detects that
  marker, calls `agent_request_human_input`, reports upstream that it is waiting
  when possible, and does not send the marker as a normal answer.
- **Tests**: Contex covers notification/state/task blocker/timeline visibility;
  CodeSurf covers marker parsing and runtime escalation.

Current behavior: Agents still communicate through link-gated Contex messages;
human escalation is a separate attention channel, so independent runtime loops
remain autonomous while preserving human control at sensitive boundaries.

## Next session

## Live CodeSurf validation polish (this session)

The live CodeSurf + Contex Agent workflow now has the compatibility surface the
UI expects:

- **Status tools** (`src/tools.mjs`, `src/index.mjs`): added `list_peers`,
  `list_tasks`, and `list_file_claims` MCP tools. `list_peers` returns registered
  Agents as peers, while tasks and active claims reuse the existing domain data.
- **Link semantics** (`src/domain/links.mjs`): Contex now preserves CodeSurf's
  Phase E link kinds: `handoff`, `reviews`, `review`, and `broadcast_group` in
  addition to the existing collaboration kinds.
- **Lifecycle guardrails**: the live validation confirmed the tile state machine
  correctly rejects `idle -> done`; Agents should move through `working` before
  completing.
- **Tests** (`test/agents.test.mjs`): tool catalog coverage now includes the
  compatibility status tools and semantic link preservation.

**Tests: Contex full suite passing** (`npm --prefix Contex test`).

## Next session

Core Contex Phases 1–12 and Agent Platform Upgrade Phases 1–6 are done. Current
context recovery entry points:

```text
Contex/AGENT_PLATFORM_UPGRADE.md
Contex/AGENT_PLATFORM_PHASE1.md
Contex/src/domain/agents.mjs
Contex/src/store.mjs
Contex/src/resources.mjs
Contex/test/agents.test.mjs
CodeSurf/scripts/agent-runtime-codex.mjs
CodeSurf/test/agent-runtime-codex.test.mjs
CodeSurf/public/tiles.mjs
```

Natural next step: decide the next Agent Platform upgrade slice. Strong
candidate: CodeSurf timeline UI panels backed by the new timeline resources.
Recommended first files:

```text
CodeSurf/public/canvas.js
CodeSurf/public/tiles.mjs
CodeSurf/public/style.css
```
