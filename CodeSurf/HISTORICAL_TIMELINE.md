# CodeSurf Historical Timeline and Behavior Matrix

## Timeline

### May 19, 2026 — workspace memory and tile protocol

Recovered artifacts already include:

- “CodeSurf Workspace Memory”;
- `.contex/tile-*` objective, Skills, and state;
- a broad discovered Skill catalogue;
- channel/task-oriented MCP instructions.

The memory records architecture, build rules, keyboard mappings, recent
features, and open threads.

### May 24–26 — concurrent tile branches and peer links

Multiple historical commits retain tile state and `peers.md`. A terminal tile is
linked to a chat tile. The peer file says it is auto-updated when canvas links
change.

### May 28–June 5 — memory evolves with development

`.codesurf/DREAMING.md` is updated alongside major features. It tracks:

- module split;
- rendering constraints;
- editing systems;
- asset persistence;
- open product threads;
- codebase-specific traps.

This shows the memory was active operational context, not a static project
description.

### June 3–7 — MCP and project environment integration

`.mcp.json` is updated repeatedly. CodeSurf memory warns about:

- auto-commit behavior;
- auto-push to main;
- direct Netlify production consequences;
- branch isolation not always protecting production.

These are strong signs that CodeSurf integrated local Git and deployment
workflow.

### June 8 — repository-specific tile creation

Commit `e8ecefb` creates `tile-1780832070725` with:

- objective;
- enabled TinyWorld i18n Skill;
- standard commands;
- task state.

This is a concrete example of a task-focused tile with a narrow Skill set.

### June 9 — runtime state moves out of Git

Commit `ea60b20` removes `.contex/tile-*` runtime files and updates ignore
rules. The likely architectural change is that tile runtime state became
external or ephemeral.

### June 14–16 — agent and browser tooling expands

The repository gains:

- additional AI bots;
- more agent-authored branches;
- Playwright MCP permissions;
- Claude-in-Chrome context access;
- community webhook integration.

### June 19–23 — autonomous production line

The workspace includes:

- `.polly/registry.json`;
- worktree-based plans;
- multiple agent/reviewer branches;
- high commit volume;
- continually consolidated Workspace Memory.

PollyArranger later distinguishes the headless production line from CodeSurf,
calling CodeSurf a monitoring/UX layer.

## Behavior matrix

| Behavior | Evidence | Confidence |
|---|---|---|
| Infinite pan/zoom canvas | Explicit product description | Confirmed concept |
| Multiple AI agents | Explicit instructions and Git activity | Confirmed |
| Terminal tiles | Tile type and terminal tools | Confirmed |
| Chat tiles | Recovered peer files | Confirmed |
| Visual links between tiles | Auto-updated peer files | Confirmed |
| Links determine communication | Peer-specific allowed tools | Confirmed |
| Per-tile objective | Recovered `objective.md` | Confirmed |
| Per-tile Skills | Recovered `skills.json` | Confirmed |
| Per-tile task/paused state | Recovered `state.json` | Confirmed |
| Send terminal input | MCP tool documentation | Confirmed |
| Agent-created tile | `canvas_create_tile` | Confirmed |
| Status and file display | Agent protocol requires publication | Strong inference |
| Browser tile | Playwright/Chrome use | Proposed built-in tile; tool integration confirmed |
| Document tile | Notes/context artifacts | Proposed |
| Extension tile | Historical extension Skill description | Strong inference |
| Workflow runtime | `phase`, `parallel`, `agent`, schemas | Confirmed surrounding runtime |
| Memory daemon | Generated memory label and updates | Confirmed |
| Automatic Git commit/push | Workspace Memory warning | Confirmed historical behavior |
| Cloud multi-user canvas | No direct evidence | Unknown |

## Historical workflow example

The `split-god-file` workflow demonstrates the runtime expected around CodeSurf:

### Analyze phase

- split 75 source sections into eight chunks;
- launch parallel reader agents;
- require structured output;
- merge analysis results.

### Plan phase

- provide the combined section table to a planner agent;
- constrain module count and boundaries;
- validate structured output;
- fall back to deterministic grouping if invalid.

### Extract phase

- generate a deterministic shell script;
- ask an execution agent to write it verbatim and run it;
- create a Git branch and commit.

### Verify phase

- byte-compare extracted JavaScript and CSS;
- launch local server;
- use Playwright MCP;
- inspect browser console;
- classify blocking versus ignorable errors;
- return a structured report.

This implies a CodeSurf-compatible rebuild should support:

- workflow phases;
- parallel sub-agents;
- schemas;
- deterministic non-agent steps;
- browser tools;
- artifacts;
- cancellation and visible progress.

## Workspace Memory evolution

Early memory focuses on:

- basic architecture;
- recent NPC/UI features;
- keyboard shortcuts;
- a few open bugs.

Later memory grows into:

- full module map;
- multiplayer architecture;
- deployment topology;
- CSS specificity traps;
- local versus pushed state;
- account/database constraints;
- release-wave activity;
- detailed open threads.

This suggests a consolidation strategy that increases depth as the project
grows rather than replacing memory with a short summary.

## Rebuild safety changes

Historical behavior to preserve:

- spatial organization;
- agent visibility;
- task links;
- long-term memory;
- workflow automation.

Historical behavior to change:

- auto-commit should default off;
- auto-push to main should default off;
- live credentials must not be committed;
- branch/worktree boundaries must be explicit;
- production deployment effects must be shown before action.

