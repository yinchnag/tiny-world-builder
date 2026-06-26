# CodeSurf Canvas Functional Specification

## 1. Product objective

Create a spatial development workspace where a user can see, organize, instruct,
and coordinate multiple AI agents and tools without losing the state of a large
project.

## 2. Primary user outcomes

- launch several agents without terminal-window chaos;
- understand what each agent is doing at a glance;
- connect agents to chats, browsers, documents, and status views;
- prevent agents from editing the same files unknowingly;
- delegate subtasks visually;
- retain project memory across sessions;
- replay how work moved from objective to result;
- keep dangerous Git/deployment actions explicit.

## 3. Canvas

### Navigation

- infinite pan and zoom;
- zoom-to-fit workspace or selection;
- minimap;
- keyboard navigation;
- search by tile title, task, file, agent, or tag;
- breadcrumbs for groups/frames;
- restore last viewport.

### Layout

- free positioning;
- snap-to-grid option;
- alignment guides;
- auto-layout selected subgraph;
- frames/groups;
- collapse group;
- lock position;
- duplicate tile configuration;
- layout undo/redo.

### Links

- drag from port to port;
- typed/directed or simple links;
- link labels;
- visual activity pulses for messages;
- conflict indicators;
- hover preview of peer capabilities;
- delete/reconnect;
- auto-generated links for spawned child tiles.

Links must be synchronized to Contex so they affect peer discovery.

## 4. Tile shell

Every tile has:

- ID;
- type icon;
- title;
- status color;
- task summary;
- unread/attention badge;
- controls for focus, minimize, pin, duplicate, close;
- resize handles;
- connection ports;
- optional model/provider badge;
- optional branch/worktree badge;
- last activity time.

Tile states:

- starting;
- idle;
- working;
- waiting;
- blocked;
- paused;
- done;
- error;
- disconnected.

## 5. Tile types

### 5.1 Terminal tile

Capabilities:

- local PTY terminal;
- start shell or coding-agent CLI;
- stream output;
- send text/control input;
- searchable scrollback;
- working-directory selector;
- environment profile;
- agent identity/model display;
- attach/reconnect to supported sessions;
- publish Contex state automatically;
- extract active files from explicit agent updates;
- manual “claim files” control;
- stop/restart process;
- safe kill escalation.

### 5.2 Chat tile

Capabilities:

- human instructions;
- receive linked agent messages;
- send messages to one or many linked agents;
- acknowledge requests;
- attach files, images, notes, and selected canvas context;
- thread/reply support;
- mark message as objective update, todo, or simple chat.

### 5.3 Browser tile

Capabilities:

- embedded or externally controlled browser;
- local URL navigation;
- screenshot;
- console and network summaries;
- Playwright/Chrome MCP integration;
- attach findings to agents;
- share current page context.

### 5.4 Document tile

Capabilities:

- Markdown editor/viewer;
- attach repository file or virtual note;
- comments;
- objective/spec/plan presets;
- version history;
- send selection to linked agent.

### 5.5 Status tile

Capabilities:

- list workspace agents;
- tasks/todos;
- file conflicts;
- unread messages;
- blocked work;
- recent completions;
- optional Polly registry view.

### 5.6 Memory tile

Capabilities:

- render Workspace Memory;
- show last consolidation;
- compare revisions;
- pin durable facts;
- mark incorrect/stale memory;
- trigger controlled regeneration.

### 5.7 Extension tile

Loads a sandboxed custom UI and communicates through a capability-scoped bridge.

### 5.8 Workflow tile

Optional first-class UI for programmable workflows:

- phases;
- parallel agent steps;
- structured outputs;
- progress and logs;
- retry/abort;
- artifacts.

## 6. Tile creation flows

Creation sources:

- user toolbar;
- keyboard command palette;
- context menu;
- drag a file/URL onto canvas;
- agent `canvas_create_tile` request;
- workflow execution;
- extension.

Creation wizard fields:

- tile type;
- title;
- objective;
- working directory;
- agent provider/model or shell command;
- enabled Skills;
- initial links;
- environment profile;
- approval policy;
- Git/worktree policy.

## 7. Agent lifecycle

1. Create terminal tile.
2. Start shell/agent process.
3. Inject workspace and tile environment:
   - `CARD_ID`;
   - Contex MCP URL/token;
   - repository path;
   - optional worktree path.
4. Agent registers through Contex.
5. Tile displays live status.
6. User or linked chat assigns objective.
7. Agent publishes files and progress.
8. Conflict warnings appear.
9. Agent marks done or blocked.
10. Tile retains summary and session metadata.

## 8. Objective and Skills UI

Per tile:

- objective editor;
- generated communication rules;
- enabled Skill list;
- Skill search/discovery;
- commands list;
- context attachments;
- reload status;
- acknowledgement status.

Changing an active objective requires confirmation and emits a Contex reload
notification instead of silently replacing the agent’s instructions.

## 9. Workspace Memory

### Inputs

- Git log and branch state;
- AGENTS/CLAUDE/project docs;
- selected tile completion summaries;
- open tasks and blockers;
- user-pinned facts;
- explicit corrections;
- optional conversation summaries.

### Output sections

- overview;
- durable architecture facts;
- module map;
- recent shipped work;
- development rules;
- deployment behavior;
- open threads;
- known traps;
- uncommitted/local-only work;
- stale-memory warnings.

### Safety

- generated file is visibly machine-managed;
- no secrets;
- no raw conversation dump;
- changes are diffable;
- user can reject or correct a consolidation;
- memory never directly authorizes Git or deployment actions.

## 10. Git integration

Features:

- repository status;
- branch/worktree display;
- diff summary;
- commit history;
- open PR links;
- optional worktree creation;
- safe staging/commit UI.

Defaults:

- no automatic commit;
- no automatic push;
- never push main without explicit user action;
- deployments shown as consequences before action.

Historical auto-commit/auto-push behavior may be offered only as an explicit,
high-friction automation profile.

## 11. Notifications and attention

- tile border pulse for new messages;
- blocked tile badge;
- global attention queue;
- optional native notifications;
- quiet hours;
- notification grouping;
- one-click focus on source tile;
- acknowledgement history.

## 12. Workspace persistence

Persist:

- viewport;
- tile layout and size;
- links;
- groups;
- tile configuration;
- session references;
- objectives and Skills;
- UI preferences.

Runtime coordination state lives in Contex. CodeSurf should cache enough layout
state to open even if Contex is temporarily unavailable.

## 13. Accessibility

- complete keyboard operation;
- screen-reader labels for tiles and links;
- high-contrast status colors plus non-color indicators;
- reduced-motion mode;
- configurable terminal font;
- focus order independent of visual position;
- canvas object list as an accessible alternative view.

## 14. Non-functional targets

- smooth canvas interaction with 200 visible tiles;
- terminal output virtualization;
- workspace opens under 3 seconds for 100 tiles;
- crash recovery for terminal metadata and unsaved notes;
- no secret values in workspace export;
- extension isolation;
- local-first operation without cloud account.
