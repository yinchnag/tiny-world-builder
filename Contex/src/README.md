# Contex `src/`

Implementation of the Contex coordination service. Layered, transport-agnostic
core with a thin MCP/HTTP shell on top.

```
db.mjs              SQLite open + schema/migrations (node:sqlite, WAL, FKs)
store.mjs           cross-cutting helpers: clock, audit writer, idempotency cache
errors.mjs          ContexError + stable CONTEXT_* codes
ids.mjs             prefixed entity id generation
auth.mjs            in-memory bearer token: create / constant-time compare / parse

domain/
  workspace.mjs     workspace create/get + sole-workspace resolution
  tiles.mjs         peer_set_state: state machine, optimistic concurrency,
                    claim sync, heartbeat→offline derivation, normalization
  links.mjs         canvas edges = runtime peer graph (link/unlink/discovery)
  peers.mjs         peer_get_state: discovery + type-derived tools + conflicts
  messaging.mjs     link-gated messages (persist-before-deliver) + todos

index.mjs           createContex(): the embedding facade used by tools + tests
tools.mjs           MCP tool catalog + dispatch + idempotency wrapper
server.mjs          JSON-RPC over HTTP POST /mcp + bearer auth + /health
cli.mjs             `contex serve` launcher handshake
```

Dependency direction: `cli → server → tools → index → domain/* → {db, store,
errors, ids}`. Nothing in `domain/` knows about HTTP or auth.

See [../PROGRESS.md](../PROGRESS.md) for what's shipped vs deferred, and
[../MCP_API.md](../MCP_API.md) / [../DATA_MODEL.md](../DATA_MODEL.md) for the spec
this implements.
