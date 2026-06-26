# Basic workflow example

A minimal end-to-end CodeSurf workflow: an **instructions** tile linked to an
**agent** terminal tile that registers with Contex and reports its progress, so
you watch its status dot change on the canvas.

It uses a tiny plain-text agent (`agent.js`) on purpose — no full-screen TUI — so
it renders correctly in the current terminal pane (xterm.js rendering for fully
interactive `claude`/`codex` is a later step).

## Run it

```bash
cd CodeSurf
node examples/basic-workflow/create-workspace.mjs   # adds "Basic Workflow" to the app
npm run app -- --contex                             # desktop app + Contex backend
#  (or web:  node src/cli.mjs serve --contex  then open the printed URL)
```

Then in the app: pick **Basic Workflow** in the workspace dropdown → click **▶**
on the **Agent** tile. The agent prints `step 1/3 … ✓ done` and the tile's status
dot goes **working → green (done)**, driven by Contex over the live stream.

`--contex` is what makes the coordination visible: it launches the Contex backend
and injects `CONTEX_URL`/`CONTEX_TOKEN` (+ `CARD_ID`) into the agent so it can
self-register. Without it the agent still runs, it just has nothing to register
with.

## What it demonstrates

The **Agent** tile runs a coordinator (`agent.js`) that:

1. **registers** with Contex (its status dot turns blue),
2. writes a **Plan** document tile with **real content** (`canvas_create_tile` +
   `content`),
3. spawns a **Worker** terminal tile that **auto-runs its own agent**
   (`worker.js` via `canvas_create_tile` + `command`) — a *second* agent that
   registers itself and writes a real artifact (`WORKER_OUTPUT.md`),
4. **finishes** (dot turns green).

So you see two agents collaborating on one canvas, a document with real content,
and a real file produced — the full pattern, not just plumbing.

**Run a real agent here today:** change `worker.js` (or the coordinator's spawned
command) to `claude -p "<task>"` — print mode, no TUI, or just `claude` for the
full interactive UI (xterm renders it). The generated `.mcp.json` (env-ref, no
token on disk) lets it discover Contex, subject to Claude Code's one-time
project-server trust approval.
