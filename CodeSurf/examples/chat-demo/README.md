# Chat demo (Phase 6 — human ↔ agent)

A **Chat** tile linked to an **Agent** terminal that runs `chat-agent.js`. Type in
the Chat tile and the agent replies — the human control loop on the canvas.

## Run it

```bash
cd CodeSurf
node examples/chat-demo/create-workspace.mjs   # adds "Chat Demo" to the app
npm run app                                    # desktop app (starts Contex itself)
```

Then: pick **Chat Demo** → click **▶** on the **Agent** tile (starts the agent;
it registers with Contex and links to the Chat tile) → type a message in the
**Chat** tile and press Enter. The agent replies in the Chat tile (and logs the
exchange in its own terminal). Try `hello`, `status`, `count to 3`.

## What it shows

- a Chat tile sends your message to its **canvas-linked** agent via Contex
  (`peer_send_message`, link-gated),
- the agent (a real process) **reads its inbox** and **replies**,
- the reply streams back into the Chat tile (via the `message_received`
  notification).

`chat-agent.js` is a tiny stand-in. Swap the Agent tile's command for `claude`
(which checks messages per `.claude/CLAUDE.md`) to chat with a **real** agent —
the wiring is identical.
