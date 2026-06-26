# CodeSurf Tile and Extension Model

## 1. Tile manifest

```json
{
  "id": "tile-1779176041759",
  "type": "terminal",
  "title": "TinyWorld implementation",
  "position": {"x": 120, "y": 80},
  "size": {"width": 720, "height": 480},
  "status": "working",
  "config": {
    "cwd": "/path/to/repo",
    "command": "claude",
    "objectiveVersion": 4
  },
  "ports": [
    {"id": "peer", "direction": "both", "protocol": "context-peer"}
  ]
}
```

## 2. Layout document

```json
{
  "version": 1,
  "workspaceId": "ws_tinyworld",
  "viewport": {"x": 0, "y": 0, "zoom": 0.85},
  "tiles": [],
  "links": [],
  "groups": [],
  "updatedAt": "2026-06-25T00:00:00Z"
}
```

Layout writes should use optimistic revisions and conflict-safe merges for
independent tile movement.

## 3. Built-in tile contract

Every tile adapter implements:

```text
create(config)
mount(host)
update(config)
focus()
serialize()
restore(snapshot)
handleContextEvent(event)
handleCanvasCommand(command)
dispose()
```

Optional capabilities:

- terminal input;
- chat receive;
- URL navigation;
- file display;
- objective editing;
- screenshot/export;
- process supervision.

## 4. Extension package

Historical Skill evidence suggests:

```text
my-extension/
  extension.json
  main.js
  ui/
    index.html
  backend/
    server.js
  assets/
```

Proposed `extension.json`:

```json
{
  "id": "com.example.status-tile",
  "name": "Example Status",
  "version": "1.0.0",
  "entry": "main.js",
  "tile": {
    "html": "ui/index.html",
    "defaultSize": {"width": 480, "height": 320}
  },
  "backend": {
    "entry": "backend/server.js",
    "optional": true
  },
  "permissions": [
    "context:tile:read",
    "context:message:send"
  ]
}
```

## 5. Activation API

Historical evidence mentions `main.js` with `activate()`.

Proposed:

```js
export async function activate(api) {
  api.tiles.registerType(...)
  api.commands.register(...)
  api.context.subscribe(...)
}

export async function deactivate() {}
```

## 6. Tile UI bridge

Historical evidence mentions `window.contex`. Preserve it as a compatibility
alias while offering `window.codesurf`.

Example:

```js
const tile = await window.codesurf.getCurrentTile()
const peers = await window.codesurf.context.getPeers()
await window.codesurf.context.sendMessage(peerId, 'Ready for review')
```

Bridge namespaces:

- `tile`
- `context`
- `canvas`
- `files`
- `commands`
- `notifications`
- `storage`

## 7. Extension permissions

Permissions must be explicit:

- read own tile;
- read linked peers;
- send messages;
- create tiles;
- read selected files;
- write extension storage;
- run backend command;
- network access;
- terminal control.

No extension receives arbitrary filesystem or terminal access by default.

## 8. Sandboxing

UI:

- sandboxed iframe;
- restrictive Content Security Policy;
- postMessage bridge with origin/source validation;
- no Node integration.

Backend:

- separate child process;
- restricted environment;
- declared filesystem roots;
- timeout and memory limits;
- explicit network policy;
- lifecycle tied to extension activation.

## 9. Tile state synchronization

CodeSurf layout state:

- position;
- size;
- collapsed/pinned;
- UI-local configuration.

Contex state:

- status;
- task;
- peers;
- messages;
- claims;
- objectives;
- todos.

The tile shell merges both views but keeps ownership clear.

## 10. Session handling

Terminal session record:

```text
tile_id
process_kind
command
cwd
pid_or_session_ref
agent_provider
agent_session_id
started_at
stopped_at
exit_code
reconnect_supported
```

Do not assume every CLI supports native session resume. A tile may reconnect to
the process, soft-resume from its worktree, or start a new process with retained
objective/context.

