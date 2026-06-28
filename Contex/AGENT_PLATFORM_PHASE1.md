# Contex Agent Platform Phase 1

Date: 2026-06-28
Status: complete
Scope: documentation, protocol boundary, and implementation handoff

## Decision

Contex is the local Agent Platform. It owns agent identity, state, messages,
tasks, audit, and coordination policy.

CodeSurf is the visual orchestration layer. It owns tile creation, canvas layout,
links as user-authored communication intent, and live observation of agent work.

Runtime adapters are not the platform. `CodeSurf/scripts/codex-chat-agent.mjs`
remains the MVP Codex bridge: it receives messages through Contex, calls
`codex exec`, and writes replies back through Contex. Future adapters should be
replaceable processes that register into Contex through the semantic Agent API.

## Current MVP

The current working flow is:

```text
Human Chat -> terminal_codex_agent
terminal_codex_agent runs CodeSurf/scripts/codex-chat-agent.mjs
codex-chat-agent.mjs calls codex exec
reply returns to Human Chat through Contex
```

This validates that Contex can already carry a human-to-agent message loop over
the existing peer/message primitives.

## Existing Primitives

Phase 2 should wrap these primitives instead of adding new storage first:

| Agent concept | Existing Contex primitive |
| --- | --- |
| Agent registration | `peer_set_state` with `tile_type: "terminal"` or future `agent` type |
| Agent status | `peer_set_state.status`, `task`, `summary`, `blocker` |
| Agent discovery | `peer_get_state`, `listTiles`, `listLinks` |
| Direct message | `peer_send_message`, `peer_read_messages` |
| Human chat | `chat_send_message`, `chat_acknowledge` |
| Communication policy | `link_tiles`, `unlink_tiles`, `canActOn` |
| Task claim/complete | `create_task`, `update_task`, `pause_task` |
| Context bundle | `get_context`, objective/skills/attachments resources |
| Audit trail | existing audit events and `context://workspace/{id}/audit` |

## Semantic API For Phase 2

The first Agent API should be a thin semantic layer over the table above:

```text
agent_register
agent_update_state
agent_list
agent_send_message
agent_read_messages
```

Deferred until later phases:

```text
agent_claim_task
agent_complete_task
agent_request_handoff
agent_broadcast
```

## Compatibility Rules

- Keep all existing `peer_*`, `chat_*`, `create_task`, `update_task`, and
  `get_context` tools working.
- Do not rename database tables in Phase 2.
- Use unique agent IDs, but preserve the tile ID bridge for CodeSurf display.
- A directed CodeSurf link should allow messages/tool flow only from source to
  target. An undirected link allows both directions.
- Agent messages should remain auditable as ordinary Contex messages.

## Phase 2 Handoff

Start with:

```text
Contex/src/domain/agents.mjs
Contex/src/tools.mjs
Contex/src/index.mjs
Contex/test/agents.test.mjs
```

Recommended test cases:

- `agent_register` creates or updates a tile-backed agent state.
- `agent_update_state` updates status/task/summary without requiring callers to
  know `peer_set_state`.
- `agent_list` returns registered agents by workspace, role, status, and
  capability filters.
- `agent_send_message` delivers through existing link-gated messaging.
- `agent_read_messages` returns messages addressed to the agent.
- Existing peer/chat tools remain unchanged.

