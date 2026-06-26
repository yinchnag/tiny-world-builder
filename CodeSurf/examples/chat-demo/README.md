# Chat demo (Phase 6 — human ↔ agent)

A **Chat** tile linked to an **Agent** terminal. Type in the Chat tile and the
agent replies — the human control loop on the canvas. Two agents are included:

- **`claude-bridge.js`** (default) — forwards each message to the **real `claude`
  CLI** and replies with Claude's actual answer, keeping the conversation thread
  (uses tokens, takes a few seconds). Needs `claude` on PATH.
- **`chat-agent.js`** — a free/instant **canned-reply** stub (no AI), just to show
  the messaging plumbing. Switch to it by changing the Agent's command.

## Run it

```bash
cd CodeSurf
node examples/chat-demo/create-workspace.mjs   # adds "Chat Demo" to the app
npm run app                                    # desktop app (starts Contex itself)
```

Then: pick **Chat Demo** → click **▶** on the **Agent** tile (starts the bridge;
it registers with Contex and links to the Chat tile) → type a message in the
**Chat** tile and press Enter. Claude's answer appears in the Chat tile (and the
exchange is logged in the Agent terminal). Ask it anything; follow-ups remember
the thread.

## What it shows

- a Chat tile sends your message to its **canvas-linked** agent via Contex
  (`peer_send_message`, link-gated),
- the agent (a real process) **reads its inbox** and **replies**,
- the reply streams back into the Chat tile (via the `message_received`
  notification).

The default `claude-bridge.js` runs Claude in a neutral temp dir (so this repo's
`CLAUDE.md`/`.mcp.json` don't steer it). To let Claude **work on a real repo**
(read/edit files), point its `WORK` dir at that repo.
