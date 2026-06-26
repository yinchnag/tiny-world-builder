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

- a tile running a **real process** with injected `CARD_ID` + Contex creds,
- the agent **self-registering** and updating status/progress via Contex,
- the canvas reflecting that peer state live (status dot),
- a **link** between coordinator and worker tiles.

Swap `agent.js` for `claude -p "<prompt>"` (print mode — no TUI) to drive a real
agent here today; a generated `.mcp.json` (env-ref, no token on disk) lets it
discover Contex, subject to Claude Code's one-time project-server trust approval.
