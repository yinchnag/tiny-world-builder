# CodeSurf Proposed Architecture

## 1. Components

```text
Desktop Shell
├── Canvas Renderer
├── Tile Host
│   ├── Terminal Tile
│   ├── Chat Tile
│   ├── Browser Tile
│   ├── Document Tile
│   ├── Status Tile
│   ├── Memory Tile
│   └── Extension Tile
├── Workspace Store
├── Process Supervisor
├── Contex MCP Client
├── Git Adapter
├── Skill Discovery
├── Workflow Runtime
├── Memory Daemon Supervisor
└── Extension Host
```

## 2. Recommended stack

- Desktop: Electron or Tauri.
- UI: TypeScript with React/Svelte/Vue.
- Canvas: a maintained node-graph/canvas library or custom WebGL/SVG hybrid.
- Terminal: xterm.js with a PTY backend.
- Local backend: Node process for best compatibility with coding-agent CLIs.
- Persistence: SQLite for workspace metadata plus JSON layout snapshots.
- Contex integration: MCP HTTP client with streaming notifications.

Electron is the lower-risk first implementation because terminal/process and
Node-based extension integration are central. Tauri can be evaluated after the
contracts stabilize.

## 3. Process model

### Main process

- opens windows;
- owns PTYs and child processes;
- launches Contex;
- manages credentials;
- performs filesystem/Git operations;
- hosts extension backends;
- enforces permissions.

### Renderer

- renders canvas and tiles;
- never receives unrestricted filesystem access;
- communicates through typed IPC.

### Contex server

- separate supervised process;
- restartable independently;
- no UI dependency;
- publishes MCP endpoint/token to main process.

### Extension processes

- isolated per extension or shared restricted host;
- killed when extension is disabled.

## 4. State ownership

| State | Owner |
|---|---|
| Tile position/size | CodeSurf |
| Canvas links | CodeSurf authored, Contex mirrored |
| Agent presence/status | Contex |
| Messages/tasks/todos | Contex |
| Terminal process | CodeSurf process supervisor |
| Objective/Skills | Contex canonical, CodeSurf editor |
| Git repository state | Git filesystem |
| Workspace Memory | Generated artifact + memory metadata |
| Polly item lifecycle | Polly registry |

## 5. Event flow

Example: agent requests a child tile.

1. Agent calls `canvas_create_tile` on Contex.
2. Contex validates permission and stores a command.
3. CodeSurf receives command notification.
4. CodeSurf creates terminal tile and persists layout.
5. CodeSurf creates requested link.
6. New terminal launches with `CARD_ID`.
7. New agent registers with Contex.
8. Contex marks command complete.
9. Requesting agent receives tile ID/result.

## 6. Offline behavior

If Contex is offline:

- canvas remains navigable;
- terminals remain usable;
- layout edits are cached;
- status is marked stale;
- message/task actions queue locally or are disabled with explanation;
- CodeSurf attempts supervised restart.

If CodeSurf is offline:

- Contex preserves messages and commands;
- terminal agents connected directly to Contex continue coordinating;
- canvas commands wait until expiry.

## 7. Workflow runtime

Historical workflow primitives suggest:

```js
phase('Analyze')
await parallel([...])
await agent(prompt, { label, phase, schema })
log('...')
return result
```

Rebuild as a typed workflow SDK:

- deterministic workflow definition;
- explicit phase tree;
- bounded parallelism;
- structured output validation;
- cancellation;
- retries;
- artifacts;
- visual workflow tile;
- no arbitrary implicit Git push.

## 8. Skill discovery

Scan configured roots:

- repository `.claude/skills`;
- repository `.codex/skills`;
- repository `.agents/skills`;
- user-level Skill roots;
- command directories.

Store metadata only until the user enables a Skill for a tile. Respect repository
trust boundaries and never execute Skill scripts during discovery.

## 9. Memory daemon

Pipeline:

1. collect bounded evidence;
2. redact secrets;
3. detect changed areas;
4. propose memory update;
5. validate factual references;
6. present diff or auto-apply under explicit policy;
7. write timestamp and source metadata.

Memory should be split into:

- generated durable memory;
- user-pinned facts;
- stale/contested entries;
- session summaries.

## 10. Security boundaries

- project trust prompt before running commands;
- per-tile environment profiles;
- no token display in renderer logs;
- extension permissions;
- explicit terminal input control;
- explicit Git write/push permissions;
- path allowlists;
- audit of agent-created tiles and commands;
- secret redaction in export and memory.
