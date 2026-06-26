# CodeSurf — build progress

> Rebuild of the **CodeSurf** infinite-canvas workspace (the visual + process
> layer above the [Contex](../Contex/PROGRESS.md) MCP coordination backend) from
> the recovered traces in this repo. Same "archaeological rebuild" method as
> [PollyArranger](../PollyArranger/PROGRESS.md) and Contex: read this file first,
> update it last, one milestone per session.

Design docs live alongside this file (`README.md`, `ARCHITECTURE.md`,
`FUNCTIONAL_SPEC.md`, `TILE_AND_EXTENSION_MODEL.md`, `DEVELOPMENT_PLAN.md`,
`EVIDENCE.md`, `HISTORICAL_TIMELINE.md`). Implementation is under `src/`, tests
under `test/`.

## Scope decision (2026-06-26)

Build a **minimal usable canvas GUI**, not the full 15-phase product in
`DEVELOPMENT_PLAN.md`. Functional closure over polish; match original behavior
over new features. The 16 plan phases (0–15) are condensed into 5 milestones:

| Milestone | Plan phases | Goal |
|---|---|---|
| **M1 Workspace store + shell** | 1 | crash-safe layout persistence, runnable CLI |
| M2 Infinite canvas | 2 | DOM/SVG pan/zoom, tile placement, links, minimap |
| M3 Generic tile host | 3 | tile shell/registry/serialization/error isolation |
| M4 Contex client | 4 | connect backend, mirror links, subscribe, drain canvas command bus |
| M5 Terminal tile | 5 | run a real agent in a tile, inject `CARD_ID`, publish state |

### Stack decision

`ARCHITECTURE.md` recommends Electron, but that conflicts with the **zero-runtime-
dependency** convention shared with Contex. So CodeSurf is built as a
**zero-dependency Node backend + browser-native DOM/SVG canvas** served over
loopback HTTP (mirroring Contex's hand-rolled transport style); `node --test`
covers the backend. **Electron is deferred**, re-evaluated once tile/process
contracts stabilize (it becomes attractive at M5 for real PTYs).

Requires Node >= 22.5 (matches Contex). Zero runtime dependencies.

## How to run

```bash
cd CodeSurf
npm test                              # node --test  (all offline, temp dirs)
node src/cli.mjs create --name X --repo <path>
node src/cli.mjs list
npm run serve                         # canvas at http://127.0.0.1:<port>/ (loopback only)
node src/cli.mjs serve --port 8742    # fixed port
```

Data dir resolves to `%LOCALAPPDATA%/CodeSurf/workspaces` (win) or
`$XDG_DATA_HOME/CodeSurf/workspaces`; override with `CODESURF_DATA_DIR`.

## Status

- [x] **M1 — workspace store + shell**
- [x] **M2 — infinite canvas** (loopback HTTP shell + DOM/SVG pan/zoom, tiles, links, minimap, fit, autosave)
- [x] **M3 — generic tile host** (type registry, serialization, unknown-type preservation, error boundary, badges, minimize/pin, focus order)
- [x] **M4 — Contex launcher + MCP client** (supervisor, MCP Streamable-HTTP client, connection orchestrator, link mirror, command-bus drain, status/events to browser)
- [x] **M5 (increment 1) — terminal tile** (piped child + env injection + live stream + stdin; real-PTY is a follow-up)

## M1 — workspace store + shell (this session)

The CodeSurf-owned persistence half (Contex owns live agent/message/task state;
CodeSurf owns tile positions, links, viewport). Each workspace is a folder:
`workspace.json` (metadata) + `layout.json` (+ rotated `.bak`) + `workspace.lock`.

- **Crash-safe writes** (`src/store.mjs` `writeJsonAtomic`): temp file →
  `fsync` → atomic `rename`, so a crash mid-save never corrupts a good file.
- **Backup recovery** (`_loadLayout`): a save rotates the prior good layout to
  `.bak`; on a parse failure the loader restores from `.bak`, quarantines the
  bad file as `.corrupt`, and flags `recovered: true`; with no backup it resets
  to an empty flagged layout (never throws on open).
- **Single-open lock** (`_acquireLock`): a `workspace.lock` names pid+host+time;
  a live owner blocks a second open (`CODESURF_WORKSPACE_LOCKED`), a dead-pid or
  foreign-host-with-no-proof lock is stolen. Liveness probed via `process.kill(pid, 0)`.
- **Secret-free export** (`scrubSecrets`): deep-drops `env`/`token`/`headers`/
  `password`/`authorization`/`apiKey`/`bearer` — honors EVIDENCE.md's warning
  that tokens once leaked to VCS.
- **Layout validation** (`validateLayout`): canonical `{ schemaVersion,
  viewport, tiles, links }`; coerces a bad viewport, rejects non-array tiles/links.
- **CLI** (`src/cli.mjs`): `list` / `create`; `serve` stubbed to M2.
- **Facade** (`src/index.mjs`): data-dir resolution + store handle.

**Tests: 12 passing** (`test/store.test.mjs`): round trip, restart recovery,
missing/invalid repo, missing args, simultaneous-open prevention + release,
stale-lock steal, `.bak` recovery, no-backup reset, secret-free export, archive
filtering, recursive non-mutating scrub, layout validation.

Exit criterion met: a blank workspace can be created, opened, saved, closed, and
restored across a simulated restart.

## M2 — infinite canvas (this session)

The loopback HTTP shell + the DOM/SVG canvas, both zero-dependency.

- **HTTP shell** (`src/server.mjs`): `node:http` server, binds `127.0.0.1` only
  and rejects non-loopback `Host` headers (cheap DNS-rebinding guard — the
  renderer is a local browser, so that's the trust boundary). Serves
  `public/` static assets + a small JSON API over the M1 store:
  `GET/POST /api/workspaces`, `GET /api/workspaces/:id` (opens + locks),
  `PUT /api/workspaces/:id/layout` (autosave), `POST .../close` (release lock).
  Business errors map to HTTP status by `CODESURF_*` code (404/409/400). `serve`
  wired into the CLI; data dir from `index.mjs`.
- **Canvas** (`public/canvas.js` + `index.html` + `style.css`): pan (drag empty
  space), zoom-toward-cursor (wheel, 0.1–4×), tile placement (double-click or
  `+ Tile`), drag/resize tiles, draw directed links by dragging a tile's port
  onto another tile, delete (× or Delete key), **minimap** (bbox + viewport rect,
  click-to-recenter), **zoom-to-fit** (`Fit` / `f`), reset-zoom, and **debounced
  autosave** (600 ms) back through the store. Workspace switcher + new-workspace
  dialog; lock released on unload via `sendBeacon`. Viewport model documented at
  the top of the file (`translate(x,y) scale(zoom)`).
- **Bug fixed**: re-opening an already-open workspace from the *same* store now
  short-circuits (idempotent) instead of throwing `WORKSPACE_LOCKED`; a
  *different* store is still blocked (the two-window guard).

**Tests: 23 passing** (12 store + 11 server). Server suite drives real HTTP:
static shell + asset content-types, full create/list/open/save/close round trip,
missing-repo 400, second-store 409 lock, unknown-workspace/route 404, raw-socket
non-loopback-Host 403 + loopback-with-port 200, invalid-JSON 400. Plus an
in-process live smoke (`scratchpad/smoke-m2.mjs`): page loads, create → save →
reopen restores tiles + zoom.

**Not verified here:** the canvas *interactions in a real browser* (drag, link
draw, minimap) — there is no headless browser in the build loop, so that hands-on
smoke is a user step (`npm run serve`, open the printed URL). Backend behavior is
covered by tests; the frontend is syntax-checked (`node --check`) only.

## M3 — generic tile host (this session)

Promoted the M2 placeholder `.tile` into a registry-driven host so a new tile
type is "register and done" — the canvas core never names a concrete type.

- **Pure model + registry** (`public/tiles.mjs`, zero DOM): `TileRegistry`
  (register/has/get/list); `get(type)` always returns a usable def, falling back
  to an **unknown-type placeholder** that preserves the original type + data.
  `normalizeTile` (defaults, min-size clamp, `unknown` flag), `serializeTile` /
  `deserializeTile` (lossless round-trip; unknown tiles keep type+data, derived
  `unknown` is not persisted), `safeRender` (**error boundary** — a throwing
  renderer yields a fallback, never crashes the canvas), `focusOrder`
  (reading-order, pinned first). Built-in types: note / terminal / chat / status
  / browser / document — placeholders whose `capabilities` mirror Contex's
  type-derived tool gating (terminal advertises `terminal_input`, which Phase-8
  `terminal_send_input` requires). **This module is imported by both the browser
  (`/tiles.mjs`) and the Node tests** — so the host logic is unit-tested without
  a browser.
- **Generic static serving** (`src/server.mjs`): replaced the fixed asset
  allowlist with safe `public/`-rooted serving (extension→content-type, traversal
  guard) so `/tiles.mjs` and future assets load.
- **Canvas integration** (`public/canvas.js`): tiles render via
  `registry.get(type)` + `safeRender`; header now has a status dot, type label,
  and **minimize / pin / close** buttons; pinned tiles don't drag; element-level
  try/catch so one broken tile renders an error card instead of aborting the
  render; **Tab / Shift-Tab** walk tiles in `focusOrder` (center + focus);
  `+ Tile` uses a registry-populated type picker; open normalizes every tile,
  save serializes them.

**Tests: 36 passing** (12 store + 13 server + 11 tiles). New tile suite covers
registry resolution, unknown-type placeholder (non-throwing), default/clamp
sizing, **lossless unknown-tile round-trip** (the plan's "restore unknown tile"),
resize persistence, **crash isolation** (safeRender catches a throwing renderer),
escaping, and **focus order**. New server tests: `/tiles.mjs` served, traversal
rejected, missing asset 404. Live smoke (`scratchpad/smoke-m3.mjs`) confirms over
real HTTP: page picker present, `/tiles.mjs` served, terminal default size +
capability, and an unknown future-type tile round-trips with its data intact.

**Not verified here:** browser interactions (minimize/pin/Tab focus/error card
rendering) — same as M2, the hands-on smoke is a user step (`npm run serve`).

## M4 — Contex launcher + MCP client (this session)

Wired CodeSurf to the finished Phase-1–8 backend. Three zero-dep backend modules,
all tested against mocks, then proven end-to-end against **real Contex**.

- **MCP client** (`src/mcp-client.mjs`): hand-rolled Streamable-HTTP client —
  `initialize`→session→`notifications/initialized`, `tools/list`, `call()`
  (returns structuredContent, throws `McpCallError` on business errors, auto-
  recovers once from a 404 expired session), a GET **SSE notification stream**
  with **event de-duplication** (by `id`) and **backed-off reconnect**, and
  `close()` (DELETE session). `McpAuthError` on 401 (token rotation).
- **Process supervisor** (`src/contex.mjs`): spawns `node --experimental-sqlite
  Contex/src/cli.mjs serve`, parses the stderr `listening` handshake
  (`{url, token, workspace_id}`), and **restarts with backoff on crash** — each
  restart re-emits a fresh token (a Contex reboot IS a token rotation). Token is
  held in memory, never logged.
- **Connection orchestrator** (`src/contex-connection.mjs`): ties supervisor →
  client; a restart transparently rebuilds the client against the new url+token.
  `linkTiles`/`unlinkTiles` mirror canvas edges (`link_tiles`/`unlink_tiles` with
  the real `source_tile_id`/`target_tile_id`/`workspace_id` args), **drains the
  canvas command bus** (`canvas_next_commands` → emit `command` → caller fulfills
  → `completeCommand`), wakes the drain early on a `canvas_command` notification,
  and re-emits `tile_state`/`attention`/`link_changed`. `status` ∈
  disconnected/connecting/connected/offline.
- **Server endpoints** (`src/server.mjs`, opt-in — CodeSurf runs canvas-only
  without Contex): `GET /api/contex/status` (url + workspace, **never the
  token**), `POST|DELETE /api/contex/links` (mirror), `GET /api/contex/events`
  (SSE forward of notifications + status + tile_state). Generic static serving
  also added back in M3.
- **Frontend** (`canvas.js` + topbar pill): a **Contex status pill**, link
  create/delete mirror to `/api/contex/links` (best-effort), and an
  `EventSource` on `/api/contex/events` that drives tile **status dots** from
  `tile_state_changed`. **CLI**: `serve --contex` launches + supervises Contex.

**Tests: 55 passing** (12 store + 13 server + 11 tiles + 7 mcp-client +
4 supervisor + 6 connection + 2 server-contex). Mocks: a mock MCP server
(`test/helpers/mock-mcp.mjs`, with `push()`/`setToken()`/`dropStreams()`) and a
fake-contex script. Covered: handshake, tool call + error, SSE delivery +
**duplicate-event drop**, **token rotation**, **stream reconnect**; supervisor
start/restart-with-rotated-token/stop/maxRestarts; connection link-mirror arg
names, **queued command delivery + completion**, notification-woken drain,
tile_state forwarding, offline-on-rotation; server status(no-token)/link/SSE +
503-without-Contex.

**Verified against REAL Contex** (`scratchpad/smoke-m4-real.mjs`): supervisor
boots an in-memory Contex, the connection registers two peers (terminal+chat),
`link_tiles` makes them mutual peers (`peer_get_state` confirms `linked: true`),
unlink clears it, all `tile_state_changed`/`peer_link_changed` notifications
arrive over SSE, clean shutdown — **the M4 exit criterion (canvas links and
Contex peers stay consistent) holds end-to-end**. Also driven against a
user-launched **live Contex** (`scratchpad/codesurf-collab.mjs`): CodeSurf
connected via `connectDirect`, its HTTP server mirrored a link, and the full
Phase-8 **canvas command bus round trip** completed — an agent's
`canvas_create_tile` was drained by CodeSurf, fulfilled, and the
`canvas_command_result` (new tile id) arrived back at the agent. (Field note:
`canvas_next_commands` returns commands keyed `id`, while
`canvas_complete_command` expects `command_id` — the orchestrator's
`command_id: cmd.command_id || cmd.id` fallback bridges this.)

**Not verified here:** the browser pill/dot updates + link mirroring in an actual
browser — same as prior milestones, a `npm run serve --contex` hands-on step.

## Browser verification + fixes (this session)

The M1–M3 "browser interactions not verified" caveat is now closed. Drove the
real canvas in headless Chromium (Playwright) and found + fixed four bugs:

1. **Link drawing was broken** — the connection port sat at `right: -7px`
   (outside the tile) but `.tile` has `overflow: hidden`, so the port's outer
   half was clipped and `elementFromPoint` at its center returned the tile, not
   the port → port-drag never started. Moved the port inside the clip
   (`right: 3px`, `z-index: 2`).
2. **New tiles spawned at the exact same spot** — `+ Tile` always used the
   viewport center, so tiles stacked perfectly and occluded each other. Added a
   `freeSpot()` cascade that nudges a new tile down-right off any near-coincident
   tile.
3. **No bring-to-front** — overlapping tiles intercepted each other's clicks.
   `select()` now raises the tile to the end of `#world` (DOM order = paint
   order; the links `<svg>` stays first/behind).
4. **Autosave could lose the last edits on a quick reload/close** — the 600 ms
   debounce never flushed if you closed within the window. Added a
   `beforeunload` flush via `fetch(..., { keepalive: true })`, gated by a
   `dirty` flag. Also stopped opening the Contex `EventSource` when the backend
   is disconnected (was logging repeated 503s in canvas-only mode).

Verified by a committed, opt-in harness `scripts/browser-smoke.mjs`
(`npm run smoke:browser`) — boots its own throwaway server, drives Chromium,
**12/12 checks pass** (no-stack, head-drag, resize, port-link, empty-drop,
minimize, pin, delete, reload-persist, zero console errors). It resolves a
global Playwright and skips cleanly if absent, so `npm test` stays zero-dep.

## M5 increment 1 — terminal tile (this session)

A tile can now run a **real child process**, and that process can self-register
with Contex — the first end-to-end **basic workflow**.

- **Backend** (`src/terminal.mjs`, zero-dep): `Terminal` spawns a child with
  **piped stdio** (NOT a PTY yet), injects env — `CARD_ID` = tile id plus the
  Contex `CONTEX_URL`/`CONTEX_TOKEN`/`CONTEX_WORKSPACE` (from
  `ContexConnection.agentEnv()`, **server-side only — the token never reaches the
  browser**) — streams stdout/stderr, accepts stdin, `control` (interrupt/eof),
  stop/restart, and keeps a bounded scrollback. `TerminalManager` owns one per
  tile and re-emits tagged events.
- **Server** (`src/server.mjs`): `POST /api/terminals/:id/start|input|control|stop`,
  `GET /api/terminals/:id` (status + scrollback), `GET /api/terminals/:id/stream`
  (SSE: scrollback + live data + exit). 503 when terminals aren't enabled.
  `serve` always wires a `TerminalManager` (bound to the optional Contex conn).
- **Frontend**: the `terminal` tile renders a live shell (command box, ▶/■,
  output `<pre>`, stdin input). `canvas.js` wires the SSE stream + stdin, persists
  the command, reattaches to a still-running process on reload, and stops the
  process when the tile is deleted. `tiles.mjs` stays DOM-free (renders only the
  static shell). Fixed a focus issue: `select()` only raises a tile on a real
  selection change, so typing in a terminal input isn't interrupted.

**Tests: 66 passing** (+8 terminal backend: env injection, stdin echo, stop,
spawn-error, bounded scrollback, no-double-run, manager Contex-env, idle status;
+3 server-terminal: start/status/input/stop, SSE stream, 503-without-terminals).
Browser harness now **16/16** (adds: terminal runs a process with CARD_ID +
streamed output, stdin echoed).

**Basic workflow verified against REAL Contex** (`scratchpad/live-workflow.mjs`,
6/6): a terminal tile runs `node agent.js`; the agent reads its injected
`CARD_ID` + `CONTEX_URL`/`CONTEX_TOKEN`, calls `peer_set_state`, and Contex then
reports the tile **online + working** while the canvas status dot turns to
`working` over SSE. Loop closed: **canvas → tile process → Contex → canvas**.

**Deliberately deferred (M5 increment 2+):** a true PTY (node-pty / ConPTY) for
fully interactive agent CLIs — piped stdio has no TTY (no raw-mode line editing,
isatty=false), which is where Electron/native may re-enter; writing a `.mcp.json`
(or equivalent) so a real Claude/Codex CLI auto-discovers Contex rather than a
hand-rolled agent; command-arg quoting (current split is whitespace-only);
project-trust prompt before running a command; ANSI/color rendering in the
output pane.

## Next session

**M5 increment 2 / workflow polish.** Options, roughly in value order: (a) write
a per-tile `.mcp.json` + `CLAUDE.md`/`CARD_ID` so a real `claude`/`codex` CLI
launched in a tile auto-registers (turns the demo into a real agent); (b) wire
the **canvas command bus consumer** so an agent's `canvas_create_tile` actually
creates a tile on the canvas and completes the command (the other half of a
self-driving workflow); (c) a real PTY backend for interactive fidelity. Decide
with the user. Run a real agent process inside a tile: a PTY (or
piped child as a zero-dep fallback) backend, xterm-style output in the tile body,
inject `CARD_ID` = tile id + the Contex url/token so the agent self-registers via
the MANDATORY `.claude/CLAUDE.md` protocol, process start/stop/restart, and the
`terminal_send_input` consumer path (already gated by the `terminal_input`
capability the registry advertises). This is where Electron may re-enter for a
real PTY; evaluate a zero-dep child-process fallback first.
