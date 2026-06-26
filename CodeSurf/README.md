# CodeSurf Canvas Reconstruction

## Purpose

CodeSurf is reconstructed as an infinite-canvas workspace for coordinating
multiple AI agents, chats, terminals, browsers, documents, status views, and
extensions around a software project.

The historical system used Contex MCP as its coordination backend.
CodeSurf is the visual and process-hosting layer; Contex is the state and
communication layer.

## Running the rebuild (quickstart)

The reconstruction is a **zero-dependency Node app** (no `npm install`): a
loopback HTTP server that serves a browser-native DOM/SVG canvas. Milestones
M1–M4 are implemented (workspace store, infinite canvas, generic tile host,
Contex launcher + MCP client). See [PROGRESS.md](PROGRESS.md) for status and the
milestone map.

**Requirements:** Node ≥ 22.5 (same as Contex). No runtime dependencies.

```bash
cd CodeSurf

# run the tests (all offline, temp dirs)
npm test

# optional browser smoke (needs a global Playwright; boots its own throwaway server)
#   npm i -g playwright && npx playwright install chromium
npm run smoke:browser

# --- canvas only (no coordination backend) ---
npm run serve                       # prints  http://127.0.0.1:<dynamic>/  on stderr
node src/cli.mjs serve --port 8742  # or pin a port
# then open the printed URL in a browser

# --- canvas + Contex coordination backend ---
node src/cli.mjs serve --contex     # also launches & supervises `contex serve`
                                    # (spawns Contex/src/cli.mjs; restarts on crash)
```

The server binds `127.0.0.1` only and rejects non-loopback `Host` headers; the
Contex bearer token is held in memory and never sent to the browser or logged.

**Workspaces** (a workspace = a canvas bound to a repository path):

```bash
node src/cli.mjs create --name "My Project" --repo d:\path\to\repo
node src/cli.mjs list
```

Workspace data lives under `%LOCALAPPDATA%\CodeSurf\workspaces` (Windows) or
`$XDG_DATA_HOME/CodeSurf/workspaces` (Linux/macOS); override with the
`CODESURF_DATA_DIR` environment variable. Layout is autosaved (crash-safe atomic
writes + `.bak` recovery); each workspace allows a single open window.

**Using the canvas:** double-click (or `+ Tile`) to add a tile; drag the header
to move, the corner to resize; drag a tile's right-edge port onto another tile to
link them; scroll to zoom, drag empty space to pan; `Fit` / `f` to zoom-to-fit;
the minimap (bottom-right) recenters on click; `Tab` walks tiles. With `--contex`,
the topbar shows a live Contex status pill and tile status dots reflect peer
state.

**Connecting to an already-running Contex** (instead of letting CodeSurf launch
one) is currently programmatic via `ContexConnection.connectDirect({ url, token,
workspace_id })` — see `src/contex-connection.mjs`. A CLI flag for an external
endpoint is a later convenience.

## Documents

- [EVIDENCE.md](EVIDENCE.md) — recovered CodeSurf facts and confidence levels.
- [HISTORICAL_TIMELINE.md](HISTORICAL_TIMELINE.md) — dated Git evidence,
  workspace-memory evolution, workflow observations, and behavior matrix.
- [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) — canvas, tiles, links, terminals,
  Skills, memory, Git integration, and user workflows.
- [TILE_AND_EXTENSION_MODEL.md](TILE_AND_EXTENSION_MODEL.md) — tile contracts,
  extension packaging, bridge APIs, layout persistence, and security.
- [ARCHITECTURE.md](ARCHITECTURE.md) — proposed frontend/backend architecture
  and integration with Contex MCP.
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — detailed implementation phases,
  testing, release strategy, and acceptance criteria.

## Reconstructed boundary

CodeSurf owns:

- infinite canvas rendering and navigation;
- tile creation, positioning, linking, grouping, and focus;
- terminal/chat/browser/document/status/memory tile UI;
- launching and supervising local terminal/agent processes;
- project/repository attachment;
- Skill and command selection UI;
- workspace layout persistence;
- notifications and human attention UX;
- Workspace Memory presentation and daemon supervision;
- extension tiles and their sandboxed UI bridge.

CodeSurf does not own:

- the coding model itself;
- peer/task/message persistence when Contex is available;
- Git implementation/review orchestration performed by Polly;
- Tiny World Builder application runtime.

## Product shape

```text
┌────────────────────── Infinite Canvas ──────────────────────┐
│                                                            │
│  ┌──────────────┐       link       ┌───────────────────┐   │
│  │ Terminal     │──────────────────│ Chat / Human      │   │
│  │ Claude Agent │                  │ Instructions      │   │
│  └──────────────┘                  └───────────────────┘   │
│          │                                                 │
│          │ link                                            │
│          ▼                                                 │
│  ┌──────────────┐       link       ┌───────────────────┐   │
│  │ Browser QA   │──────────────────│ Status / Tasks    │   │
│  └──────────────┘                  └───────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
                    │ Contex MCP
                    ▼
        presence, peers, messages, tasks, commands
```
