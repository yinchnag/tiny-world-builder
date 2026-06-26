# CodeSurf Canvas Detailed Development Plan

## Goal

Build a local-first desktop workspace that recreates the high-confidence
historical CodeSurf responsibilities while using the reconstructed Contex MCP
server as the coordination backend.

## Phase 0 — Product contract and design prototypes

Deliverables:

- preserve reconstructed evidence;
- define tile terminology: tile is canonical, block/card are aliases;
- wireframes for 20-, 100-, and 200-tile workspaces;
- keyboard and accessibility model;
- terminal/chat/link interaction prototypes;
- safe Git policy;
- extension threat model.

Prototype questions:

- DOM/SVG versus WebGL canvas;
- link routing and labels;
- terminal rendering performance;
- spatial search;
- compact status presentation.

Exit criteria:

- user can validate the conceptual workspace before implementation.

## Phase 1 — Desktop shell and workspace storage

Build:

- desktop app shell;
- create/open workspace;
- attach repository path;
- SQLite/JSON layout persistence;
- recent workspaces;
- crash-safe writes;
- settings;
- structured logs;
- update channel skeleton.

Tests:

- workspace round trip;
- invalid/missing repo;
- simultaneous open prevention;
- corrupted layout recovery;
- export without secrets.

Exit criteria:

- blank workspace can be opened, saved, closed, and restored.

## Phase 2 — Infinite canvas foundation

Build:

- pan/zoom;
- tile positioning/resizing;
- selection and multiselect;
- links;
- minimap;
- zoom-to-fit;
- frames/groups;
- undo/redo;
- copy/paste;
- layout autosave;
- accessible object list.

Performance tests:

- 200 empty tiles;
- 500 links;
- continuous pan/zoom;
- bulk move;
- restore large workspace.

Exit criteria:

- stable canvas interaction at target scale.

## Phase 3 — Generic tile host

Build:

- tile shell;
- status/title/badges;
- resize/minimize/pin/close;
- connection ports;
- tile registry;
- serialization;
- focus and command routing;
- error boundary;
- placeholder tile for unknown types.

Tests:

- restore unknown tile;
- tile crash isolation;
- resize persistence;
- keyboard focus order.

Exit criteria:

- multiple tile types can be added without modifying canvas core.

## Phase 4 — Contex launcher and client

Dependency: Contex phases 1–4.

Build:

- launch/supervise Contex process;
- receive dynamic port/token securely;
- MCP client;
- reconnect;
- subscribe to state/messages/links;
- mirror canvas links;
- attention queue;
- stale/offline UI.

Tests:

- Contex restart;
- token rotation;
- link synchronization;
- duplicate event handling;
- queued command delivery.

Exit criteria:

- canvas links and Contex peers stay consistent.

## Phase 5 — Terminal tile

Build:

- PTY backend;
- xterm UI;
- shell profiles;
- working directory;
- environment injection;
- `CARD_ID`;
- Contex URL/token injection;
- start Claude/Codex/custom command;
- process stop/restart;
- scrollback and search;
- terminal input command handler;
- agent state badge.

Safety:

- project trust;
- command preview;
- environment-variable allowlist;
- redact secrets from diagnostics;
- explicit kill behavior.

Tests:

- shell echo and resize;
- high-volume output;
- process exit;
- reconnect where supported;
- Contex registration;
- controlled terminal input.

Exit criteria:

- a real agent can start in a tile and publish its state.

## Phase 6 — Chat tile and human control loop

Build:

- threaded messages;
- linked-agent recipients;
- attachments;
- objective/todo conversion;
- acknowledgement;
- unread badges;
- human-attention workflow;
- message search.

Tests:

- terminal-to-chat;
- chat-to-terminal;
- offline delivery;
- attachment permission;
- broadcast to selected links.

Exit criteria:

- user can coordinate two agents without switching to external chat.

## Phase 7 — Objective, Skill, and context editor

Build:

- per-tile objective panel;
- Skill discovery;
- enable/disable;
- commands;
- context attachments;
- objective version history;
- reload/acknowledgement UI;
- virtual historical-file preview.

Tests:

- repository and user Skill merging;
- duplicate names;
- objective update during active work;
- missing Skill source;
- untrusted repository handling.

Exit criteria:

- dedicated i18n-like tile can be configured as seen in historical evidence.

## Phase 8 — Status, conflict, and task UX

Build:

- status tile;
- workspace task board;
- todo assignment;
- file claim browser;
- conflict overlays;
- blocked/paused flows;
- completion summaries;
- focus source tile.

Tests:

- two-agent file collision;
- stale claim;
- task transition;
- blocked agent requesting human attention.

Exit criteria:

- user can understand all active work from one canvas/status view.

## Phase 9 — Browser and document tiles

Build browser tile:

- local URL;
- screenshots;
- console view;
- Playwright/Chrome MCP adapter;
- send finding to agent.

Build document tile:

- Markdown;
- repository file link;
- objective/spec/plan presets;
- selection sharing;
- comments and history.

Exit criteria:

- implementation and visual QA agents can be linked in one workspace.

## Phase 10 — Git and worktree integration

Build:

- status/diff/branch views;
- optional worktree creation;
- assign terminal tile to worktree;
- stage/commit with user confirmation;
- push/PR as explicit actions;
- deployment consequence warning;
- dirty-worktree recovery.

Tests:

- multiple worktrees;
- branch deletion safeguards;
- rejected push;
- main-branch protection;
- unrelated user changes preserved.

Exit criteria:

- parallel agents have isolated workspaces without historical auto-push risk.

## Phase 11 — Workspace Memory daemon

Build:

- evidence collector;
- secret redaction;
- Git/context/task input;
- memory diff generation;
- user-pinned facts;
- correction/stale markers;
- memory tile;
- scheduled consolidation.

Validation:

- every generated claim links to an evidence source where practical;
- local-only and committed state are distinguished;
- no bearer/API keys;
- user can reject a change.

Exit criteria:

- close/reopen after several sessions and recover project architecture and open
  threads from memory.

## Phase 12 — Extension system

Build:

- extension discovery/install/disable;
- manifest validation;
- sandboxed iframe;
- typed bridge;
- permission prompt;
- optional backend process;
- extension storage;
- developer reload tooling.

Compatibility:

- `activate()` entry;
- `window.contex` bridge alias;
- self-contained tile extensions.

Tests:

- malicious iframe attempts;
- undeclared filesystem/network access;
- backend crash;
- version migration;
- uninstall cleanup.

Exit criteria:

- a third party can add a custom status tile without modifying CodeSurf core.

## Phase 13 — Workflow runtime

Build:

- workflow SDK;
- phase view;
- `agent`, `parallel`, `log`;
- structured schema validation;
- bounded concurrency;
- retries/cancellation;
- artifact viewer;
- workflow tile;
- reusable workflow packages.

Reference acceptance workflow:

- recreate the historical split-god-file analyze/plan/execute/verify pattern
  against a fixture repository without performing an automatic push.

Exit criteria:

- multi-agent workflows are inspectable and interruptible from the canvas.

## Phase 14 — Polish and scale

- canvas virtualization;
- terminal output backpressure;
- search across tiles/messages/tasks;
- command palette;
- templates;
- workspace cloning;
- accessibility audit;
- reduced motion;
- crash reporting;
- signed application builds;
- updater;
- onboarding.

## Phase 15 — Optional cloud collaboration

Only after local-first release:

- shared workspace server;
- user identity;
- remote Contex;
- encrypted remote terminals/tunnels;
- presence and permissions;
- organization policy;
- hosted audit retention.

## End-to-end acceptance scenario

1. Open a repository workspace.
2. Create a chat tile and two terminal tiles.
3. Start Claude in one and Codex in the other.
4. Link both terminals to chat.
5. Give separate objectives and Skills.
6. Both agents register through Contex.
7. One agent creates a visual-QA child tile.
8. Agents publish overlapping file claims.
9. CodeSurf displays conflict and messages.
10. User resolves ownership through chat.
11. One agent completes a todo.
12. Browser tile verifies local UI.
13. Git tile displays changes without auto-pushing.
14. Memory daemon proposes an updated Workspace Memory diff.
15. Close and reopen the app.
16. Layout, objectives, messages, tasks, status history, and memory are restored.

## Definition of done

- infinite canvas and meaningful links are stable;
- real terminal agents operate inside tiles;
- Contex supplies peers, messages, tasks, claims, and objectives;
- per-tile Skills are configurable;
- human attention is visible and actionable;
- Workspace Memory persists durable knowledge;
- workflow runtime supports parallel structured agents;
- extensions are sandboxed;
- Git writes and pushes are explicit;
- large workspaces remain responsive and accessible.
