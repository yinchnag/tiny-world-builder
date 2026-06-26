# Contex MCP Detailed Development Plan

## Goal

Build a behaviorally compatible, local-first replacement for the historical
Contex MCP server. The first usable release must support real Claude/Codex
terminal agents coordinating through CodeSurf without repository-local runtime
state.

## Recommended stack

- Runtime: Node.js 22+ and TypeScript.
- MCP SDK: official Model Context Protocol TypeScript SDK.
- HTTP: built-in HTTP or Fastify.
- Database: SQLite with a thin migration layer.
- Validation: JSON Schema or Zod at the transport boundary.
- Tests: Node test runner plus Playwright for end-to-end CodeSurf integration.
- Packaging: standalone CLI with optional desktop launcher integration.

The implementation should be dependency-light, but protocol correctness is more
important than eliminating all dependencies.

## Repository layout

```text
context-server/
  src/
    cli/
    server/
    auth/
    mcp/
      resources/
      tools/
      notifications/
      compatibility/
    domain/
      workspaces/
      tiles/
      links/
      claims/
      messages/
      tasks/
      objectives/
      commands/
    storage/
      sqlite/
      migrations/
    events/
    export/
  test/
    unit/
    integration/
    compatibility/
    e2e/
```

## Phase 0 — Evidence freeze and contract tests

Deliverables:

- preserve recovered `.contex` examples as sanitized fixtures;
- encode current `.claude/CLAUDE.md` behavior as acceptance scenarios;
- define exact reconstructed versus proposed behavior;
- remove all historical bearer values from fixtures;
- create protocol capability/version document.

Tests:

- parse recovered `objective.md`;
- parse `skills.json` and `state.json`;
- render recovered `peers.md`;
- assert modern and first-generation tool aliases map to the same domain calls.

Exit criteria:

- every confirmed behavior has at least one test or fixture;
- no proposed behavior is labelled historical fact.

## Phase 1 — Server bootstrap and authentication

Build:

- CLI command `context serve`;
- dynamic or configured loopback port;
- `/health`, `/version`, and `/mcp`;
- token generation and validation;
- token scopes;
- secure startup output for CodeSurf launcher;
- graceful shutdown;
- structured logging.

Security:

- bind only to `127.0.0.1` and `::1` by default;
- reject requests with mismatched Host where appropriate;
- never log bearer tokens;
- store launcher secret outside repository;
- expire client tokens;
- support token revocation.

Tests:

- unauthenticated request rejected;
- expired token rejected;
- scope enforcement;
- loopback defaults;
- startup/shutdown recovery.

Exit criteria:

- Claude/Codex MCP clients can initialize and list server capabilities.

## Phase 2 — Workspace and tile presence

Build:

- SQLite migrations;
- workspace create/open/list/archive;
- tile register/update/get/list;
- heartbeat and offline detection;
- optimistic version checks;
- tile status state machine;
- resource views for workspace and tile state.

Compatibility:

- `peer_set_state`;
- `peer_get_state`;
- historical server name `contex`.

Tests:

- first registration;
- repeated idempotent registration;
- reconnect with new client instance;
- stale version conflict;
- heartbeat timeout;
- done-to-new-task transition.

Exit criteria:

- two terminal clients see each other’s current status through manually seeded
  links.

## Phase 3 — Canvas links and peer discovery

Build:

- link create/delete/list;
- peer capability filtering;
- linked-peer state aggregation;
- virtual `peers.md`;
- graph-change notifications;
- workspace-wide discovery permission.

Tests:

- terminal ↔ chat tool availability;
- terminal ↔ terminal coordination;
- link deletion removes peer visibility;
- directed link behavior;
- offline peer still visible when requested.

Exit criteria:

- CodeSurf can draw links and agents can immediately discover linked peers.

## Phase 4 — Messaging and notifications

Build:

- persistent inbox;
- direct messages;
- acknowledgement;
- unread reads and pagination;
- reply/correlation IDs;
- notification stream;
- human-attention notifications;
- chat adapters.

Compatibility:

- `peer_send_message`;
- `peer_read_messages`;
- `chat_send_message`;
- `chat_acknowledge`;
- `notify`.

Tests:

- send while recipient offline, then reconnect;
- duplicate idempotency key;
- acknowledgement;
- priority ordering;
- unauthorized unlinked send;
- retention cleanup.

Exit criteria:

- a terminal agent can ask a linked chat tile a question and receive a reply.

## Phase 5 — Tasks, todos, and pause/resume

Build:

- task CRUD and transitions;
- todo assignment/completion;
- pause/block reasons;
- per-channel task views;
- task audit history;
- task notifications.

Compatibility:

- `create_task`;
- `update_task`;
- `pause_task`;
- `peer_add_todo`;
- `peer_complete_todo`.

Tests:

- valid and invalid transitions;
- concurrent updates;
- task assignment to offline tile;
- completion notification;
- task visibility by scope.

Exit criteria:

- recovered `state.json` can be imported and represented through MCP resources.

## Phase 6 — File claims and collision prevention

Build:

- claim publication through tile state;
- path normalization relative to workspace repository;
- read/edit/exclusive modes;
- conflict derivation;
- stale-claim expiry;
- conflict notifications;
- optional owner override.

Security:

- reject paths escaping configured workspace roots;
- do not read file contents to create claims;
- avoid leaking paths across workspaces.

Tests:

- all claim compatibility combinations;
- stale and offline claims;
- symlink/path traversal;
- conflict resolution after release.

Exit criteria:

- two linked agents editing the same file receive actionable warnings before
  writing.

## Phase 7 — Objectives, Skills, and context resources

Build:

- versioned objectives;
- Skill assignments;
- context attachments;
- reload-required notification;
- acknowledgement;
- `get_context`;
- `reload_objective`;
- virtual historical files;
- optional import/export of `.contex/tile-*`.

Tests:

- objective update while agent is working;
- stale acknowledgement;
- large attachment resource;
- Skill enable/disable;
- exact rendering of historical fixtures.

Exit criteria:

- CodeSurf can alter a tile objective and the running agent is prompted to
  reload it.

## Phase 8 — Canvas command bus

Build:

- persistent command queue;
- CodeSurf consumer connection;
- command lifecycle;
- `canvas_create_tile`;
- terminal input;
- focus/highlight/connect commands;
- result callbacks and expiry.

Safety:

- terminal input disabled unless target advertises support;
- audit every command;
- distinguish text input from key/control actions;
- owner confirmation for destructive actions.

Tests:

- canvas offline queue;
- duplicate command delivery;
- rejected tile creation;
- terminal input permissions;
- command timeout.

Exit criteria:

- an agent can create a child terminal tile and receive its new tile ID.

## Phase 9 — Audit, replay, and export

Build:

- append-only event log;
- correlation IDs;
- replay into read models;
- workspace export bundle;
- sanitized diagnostics;
- event feed for Workspace Memory.

Tests:

- deterministic replay;
- export/import round trip;
- secret redaction;
- damaged event recovery strategy.

Exit criteria:

- workspace coordination state survives server restart and can be inspected.

## Phase 10 — CodeSurf integration hardening

Build:

- launcher handshake;
- dynamic port/token handoff;
- reconnect behavior;
- compatibility matrix;
- UI-facing graph subscriptions;
- backpressure handling;
- upgrade/migration flow.

E2E scenarios:

1. Start CodeSurf and Contex.
2. Create terminal and chat tiles.
3. Link them.
4. Start a mock agent.
5. Register state.
6. Exchange messages.
7. Create a todo.
8. Claim conflicting files from two agents.
9. Update objective.
10. Restart Contex and verify recovery.

## Phase 11 — Optional remote/team mode

Do not begin until local mode is stable.

Potential work:

- PostgreSQL backend;
- TLS;
- user/workspace membership;
- remote agent tunnels;
- encrypted message payloads;
- organization audit retention;
- SSO.

## Observability

Metrics:

- connected tiles;
- heartbeat lag;
- unread messages;
- command queue depth;
- conflict count;
- notification delivery latency;
- MCP errors by tool;
- database transaction latency.

Logs:

- JSON only;
- workspace/tile/correlation IDs;
- never message content at default info level;
- no tokens or objective secrets.

## Definition of done

- existing `mcp__contex__peer_*` prompt instructions work unchanged;
- first-generation task tools are available as aliases;
- tile links determine peer discovery;
- messages and tasks survive restart;
- file collisions are detected;
- objective reloads reach active agents;
- CodeSurf can consume canvas commands;
- credentials never enter tracked project files;
- all reconstructed facts are documented separately from proposed additions.
