# CodeSurf / Contex Blueprint Progress

## Purpose

This is the dedicated progress file for the Blueprint-style visual runtime
direction. It is intentionally separate from `CodeSurf/PROGRESS.md` and
`Contex/PROGRESS.md` because this work cuts across both projects and may also
affect Polly Arranger integration.

The core shift:

```text
CodeSurf = visual workflow blueprint editor
Contex   = graph runtime, state machine, message bus, policy layer, and audit log
Polly    = external production-line integration exposed as typed runtime nodes
```

## Current Status

- [x] Branch created: `codex/blueprint-runtime-design`
- [x] Core design document created: `CodeSurf/BLUEPRINT_RUNTIME_DESIGN.md`
- [x] Dedicated Blueprint progress file created: this file
- [x] Current node/function inventory created: `CodeSurf/BLUEPRINT_NODE_INVENTORY.md`
- [x] Node/function evolution plan created: `CodeSurf/BLUEPRINT_NODE_EVOLUTION.md`
- [ ] Phase BP-1: Node contract registry
- [ ] Phase BP-2: Typed links and validation
- [ ] Phase BP-3: Port UI preview
- [ ] Phase BP-4: Runtime event mapping
- [ ] Phase BP-5: Workflow assets and subgraphs
- [ ] Phase BP-6: Visual debugging and replay
- [ ] Phase BP-7: Polly node integration alignment

## Why This Needs A Separate Track

This direction is larger than a normal UI feature. It changes the mental model
from "tiles connected on a canvas" to "typed executable graph".

Affected areas:

- CodeSurf tile model and registry
- CodeSurf canvas link model
- CodeSurf node UI and inspectors
- CodeSurf workflow presets
- Contex tile/link/message/task schema
- Contex MCP tools
- Contex audit and timeline payloads
- Contex resources and export/import
- Agent runtime contracts
- Polly Arranger observe/assist integration
- Browser smoke and unit test structure

## Work Arrangement

### Track A: Product Model

Goal: define the conceptual system before implementation.

Deliverables:

- Node taxonomy
- Port taxonomy
- Payload type taxonomy
- Link lane taxonomy
- Workflow asset model
- Runtime instance model

Primary files:

```text
CodeSurf/BLUEPRINT_RUNTIME_DESIGN.md
CodeSurf/BLUEPRINT_NODE_INVENTORY.md
CodeSurf/BLUEPRINT_NODE_EVOLUTION.md
CodeSurf/TILE_AND_EXTENSION_MODEL.md
Contex/FUNCTIONAL_SPEC.md
```

### Track B: CodeSurf Editor

Goal: evolve CodeSurf from visual canvas to graph editor without breaking the
current canvas.

Work items:

- Add node contracts to the CodeSurf tile registry.
- Add inputs/outputs/actions metadata for every built-in tile type.
- Add link validation using node contracts.
- Add internal support for `source_port` and `target_port` while preserving
  old tile-to-tile links.
- Add a simple node inspector showing contract, state, actions, and last events.
- Add limited port UI for Agent, Document, Browser, Terminal, and Status nodes.

Primary files:

```text
CodeSurf/public/tiles.mjs
CodeSurf/public/canvas.js
CodeSurf/public/style.css
CodeSurf/src/store.mjs
CodeSurf/src/server.mjs
CodeSurf/test/tiles.test.mjs
CodeSurf/test/server-contex.test.mjs
CodeSurf/scripts/browser-smoke.mjs
```

### Track C: Contex Runtime

Goal: make Contex graph-aware while preserving current MCP compatibility.

Work items:

- Add graph metadata to link/timeline events: `node_id`, `port_id`, `edge_id`,
  `payload_type`, `workflow_instance_id`.
- Add optional `source_port`, `target_port`, `lane`, and `payload_type` to links.
- Add type-aware validation hooks for message/task/context flows.
- Extend timeline queries so CodeSurf can replay node/edge activity.
- Keep existing `link_tiles`, `agent_*`, `peer_*`, and task tools working.

Primary files:

```text
Contex/src/domain/links.mjs
Contex/src/domain/agents.mjs
Contex/src/domain/messaging.mjs
Contex/src/domain/tasks.mjs
Contex/src/store.mjs
Contex/src/tools.mjs
Contex/src/resources.mjs
Contex/test/agents.test.mjs
Contex/test/audit.test.mjs
```

### Track D: Agent Runtime

Goal: make Agent runtimes declare and consume typed graph contracts.

Work items:

- Include node contract hints in Agent runtime prompts.
- Convert inbound messages to typed payloads before prompting.
- Emit typed outputs: report, handoff, task update, human attention.
- Preserve current plain-message compatibility.

Primary files:

```text
CodeSurf/scripts/agent-runtime-codex.mjs
CodeSurf/test/agent-runtime-codex.test.mjs
```

### Track E: Polly Arranger Integration

Goal: represent Polly as external workflow nodes without making CodeSurf or
Contex the Polly scheduler.

Work items:

- Map Polly registry to an Integration/Observer node contract.
- Map Polly items to Task/Review/HumanGate payloads.
- Represent Polly action requests as typed outputs from CodeSurf/Contex, still
  applied only by Polly.
- Add node metadata for Polly daemon, item, implementer, and reviewer identities.

Primary files:

```text
Contex/POLLY_ARRANGER_INTEGRATION.md
Contex/src/domain/polly.mjs
Contex/test/polly.test.mjs
```

If the standalone Polly Arranger repo is modified later, require a separate
review because it is outside the CodeSurf/Contex folders in this branch.

## Phase Plan

### BP-1: Node Contract Registry

Add static contracts to existing CodeSurf tile types.

Acceptance:

- Every built-in CodeSurf tile type has `inputs`, `outputs`, `actions`, and
  `state` metadata.
- Contracts are test-covered in `tiles.test.mjs`.
- No visible UI regression.
- Browser smoke remains green.

### BP-2: Typed Links

Extend the link model without requiring visible port UI yet.

Acceptance:

- Old links still load.
- New links may store `lane`, `payload_type`, `source_port`, `target_port`.
- Link validation can reject at least one invalid connection.
- Contex preserves the extra metadata when mirrored.

### BP-3: Port UI Preview

Expose small, stable ports on high-value nodes.

Acceptance:

- Agent node shows message/task/context/human ports.
- Document node shows context/selection output.
- Browser node shows finding output.
- Terminal node shows stdin/stdout ports.
- Existing simple drag-to-link remains available.

### BP-4: Runtime Event Mapping

Map Contex events back to graph elements.

Acceptance:

- Timeline events can identify node and edge when created by a graph flow.
- CodeSurf can highlight the edge that produced a message/handoff/report.
- Existing timeline APIs remain backward compatible.

### BP-5: Workflow Assets

Upgrade workflow presets into reusable graph assets.

Acceptance:

- Coordinator -> Worker -> Reviewer exists as a template, not just imperative UI
  creation code.
- A workflow instance records which template created it.
- Templates can be versioned.

### BP-6: Visual Debugging

Make runtime behavior inspectable.

Acceptance:

- Node inspector shows last inputs, outputs, errors, and state transitions.
- Edges show recent payload summaries.
- Timeline replay can step through at least one simple Agent workflow.

### BP-7: Polly Alignment

Represent Polly observe/assist flows as graph nodes.

Acceptance:

- Polly daemon and item views have contracts.
- Status tile can show Polly items as graph-backed task nodes.
- Operator requests map to typed payloads.
- Contex remains observe/assist-only; Polly still owns registry mutation.

## Open Questions

- Should `note` become a Contex `document` or remain CodeSurf-local?
- Should `git` become a first-class Contex tile type or stay CodeSurf-local?
- Should ports be visible by default, or only in an advanced graph mode?
- How strict should type validation be before runtime event mapping exists?
- What is the minimum payload schema for Agent messages?
- Should Polly item nodes be visible in CodeSurf by default or only in Status?

## Validation Commands

Baseline checks before and after each phase:

```bash
npm --prefix CodeSurf test
npm --prefix Contex test
NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser
```

When changing live Contex behavior, also run a small real CodeSurf + Contex
workflow and verify:

- semantic links mirror correctly;
- status-view has no unexpected partial failures;
- timeline events can be traced back to the intended nodes.
