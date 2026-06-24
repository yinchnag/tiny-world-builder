# AGENTS.md — handoff protocol for PollyArranger

> If you are an AI (or human) continuing the PollyArranger build, read this
> before doing anything. It exists because this project spans many sessions and
> no single session holds the whole thing in context.

## The one rule

**Externalize all memory into the repo.** Your context resets; these files don't.
A fresh session must be able to fully orient from files alone.

## Start-of-session checklist

1. Read [PROGRESS.md](PROGRESS.md) — it tells you the current phase and exactly
   where to start.
2. Run the verification commands in PROGRESS.md ("How to verify the current
   state"). **Confirm green before building.** If red, fix that first.
3. Skim only the `docs/` you need for this phase (don't re-read everything):
   - building logic? → [03-state-machine.md](docs/03-state-machine.md) + [02-data-model.md](docs/02-data-model.md)
   - building an adapter? → [04-agent-adapters.md](docs/04-agent-adapters.md)
   - unsure what "done" looks like? → [05-workflow-walkthrough.md](docs/05-workflow-walkthrough.md) is the behavior spec
   - unsure if a design fact is real or invented? → [DERIVATION.md](docs/DERIVATION.md)

## During the session

- **Scope to ONE phase (or sub-step).** Never leave a feature half-built across a
  context boundary. If a phase is too big for one session, split it at a clean,
  testable sub-step and stop there.
- Match the parent project's style: Node.js ESM (`.mjs`), no bundler, no runtime
  deps beyond what's justified.
- Keep design and DERIVATION honest: if you invent something not in the docs,
  add it to the relevant doc + note it in DERIVATION.md as inferred.
- Write tests as you go (Phase 1+). The state machine and store must be unit-test
  covered with no real agents/git (use MockAdapter).

## End-of-session checklist (the handoff)

1. **Tests green.** `npm test` passes. End on green, always.
2. **Update [PROGRESS.md](PROGRESS.md):**
   - move the phase checkbox,
   - rewrite "Next session starts here",
   - append a Session log entry (what you did, what's next, any gotcha).
3. **Record new decisions** in the PROGRESS Decisions log; **new blockers** in
   Open questions.
4. **Commit** with a clear message (the parent repo auto-pushes main; prefer a
   branch unless told otherwise). One coherent commit per session.

## Layout

```
PollyArranger/
  PROGRESS.md        ← session memory (read first, update last)
  AGENTS.md          ← this file (handoff protocol)
  README.md          ← what Polly is + doc index
  package.json       ← Node ESM, scripts
  docs/              ← the design (00→06, glossary, DERIVATION)
  examples/          ← worked registry example
  src/               ← implementation (grows phase by phase; see src/README.md)
  test/              ← tests (added Phase 1+)
```
