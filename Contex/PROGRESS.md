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
- [ ] Phase 5 — tasks (open→assigned→in_progress→review→done) + first-gen aliases
- [ ] Phase 7 — versioned objectives + skills + reload signaling
- [ ] Phase 8 — canvas command bus (`canvas_create_tile`, `terminal_send_input`)
- [ ] Phase 9 — audit replay / workspace export
- [ ] scopes & rate limits, retention jobs, `.contex/tile-*` compatibility import

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

## Next session

Phases 1–3 done (transport, presence, resources, links/discovery). Candidates:
**Phase 4** (messaging+notifications — mostly done in Round 1; gaps are
chat adapters, `notify`/human-attention, priority ordering, retention),
**Phase 5** (tasks state machine + first-gen `create_task` aliases), **Phase 8**
(canvas command bus — CodeSurf needs first), or **scopes/rate-limits**. Worth
doing once: the user-side real-client smoke (`.mcp.json` above).
