# CodeSurf Canvas Reconstruction

## Purpose

CodeSurf is reconstructed as an infinite-canvas workspace for coordinating
multiple AI agents, chats, terminals, browsers, documents, status views, and
extensions around a software project.

The historical system used Contex MCP as its coordination backend.
CodeSurf is the visual and process-hosting layer; Contex is the state and
communication layer.

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
