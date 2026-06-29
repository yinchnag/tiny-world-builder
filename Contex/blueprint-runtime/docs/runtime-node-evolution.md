# Blueprint Node Evolution Plan

This document describes how existing CodeSurf/Contex nodes and functions should
evolve toward a Blueprint-style graph system.

It complements:

- `CodeSurf/BLUEPRINT_RUNTIME_DESIGN.md`
- `CodeSurf/BLUEPRINT_PROGRESS.md`
- `CodeSurf/BLUEPRINT_NODE_INVENTORY.md`

## Target Shape

Every node should eventually declare:

```text
type
family
inputs
outputs
state model
actions
runtime owner
Contex mapping
debug metadata
```

Every edge should eventually declare:

```text
source_node
source_port
target_node
target_port
lane
payload_type
semantic_kind
directed
runtime policy
last payload summary
```

## Node Family Direction

### 1. Context Nodes

Current nodes:

- `note`
- `document`
- `memory`

Target role:

Context nodes provide durable, inspectable inputs to execution nodes.

Direction:

- `note` should either become a lightweight `document` contract or remain
  CodeSurf-local with a `context_out` port.
- `document` should expose `text_out`, `selection_out`, `objective_out`, and
  `comment_out`.
- `memory` should expose `fact_out`, `proposal_out`, and `event_summary_out`.

Suggested ports:

```text
note.context_out -> Agent.context_in
document.selection_out -> Agent.context_in
memory.fact_out -> Agent.context_in
```

Contex impact:

- Context attachments should be able to reference node/port ids.
- `get_context` should eventually return typed context bundles.

### 2. Execution Nodes

Current nodes:

- `terminal`
- `agent`

Target role:

Execution nodes do work and produce runtime events.

Direction:

- `terminal` should become a command execution node with `stdin_in`,
  `stdout_out`, `stderr_out`, and `exit_out`.
- `agent` should become a typed reasoning/execution node with message, task,
  context, human, report, and handoff ports.
- Agent panel actions should gradually split into graph nodes, while the panel
  remains a compact control surface.

Suggested ports:

```text
Agent.message_in
Agent.task_in
Agent.context_in
Agent.human_reply_in
Agent.message_out
Agent.report_out
Agent.handoff_out
Agent.human_attention_out
Agent.task_update_out

Terminal.stdin_in
Terminal.stdout_out
Terminal.stderr_out
Terminal.exit_out
```

Contex impact:

- Agent messages need payload type metadata.
- `agent_*` events should include source/target node and port ids when known.
- Terminal input commands should reference target port ids when triggered by a
  graph edge.

### 3. Human Nodes

Current representation:

- Agent handoff banner
- workspace human-attention feed
- chat tile

Target role:

Human interaction should become an explicit gate in the graph.

Direction:

- Introduce a Human Approval / Human Input node contract.
- Agent `human_attention_out` should connect to Human node `question_in`.
- Human node `approval_out` or `reply_out` should connect back to Agent
  `human_reply_in`.

Contex impact:

- `agent_request_human_input` should carry graph metadata.
- Human reply/reject/handled events should appear in timeline with edge/node
  references.

### 4. Task And Routing Nodes

Current representation:

- Tasks live in Contex.
- Status tile renders tasks.
- Agent panel can claim/complete/handoff/report.

Target role:

Tasks should be typed payloads and optionally visible nodes.

Direction:

- Add conceptual Task node contract.
- Add Task Router node contract.
- Add Review Gate node contract.
- Status tile remains an overview, not the only task UI.

Suggested ports:

```text
Task.task_out -> Agent.task_in
Agent.task_update_out -> Task.task_update_in
ReviewGate.approved_out -> Task.task_update_in
ReviewGate.changes_requested_out -> Agent.message_in
```

Contex impact:

- Task lifecycle events should include graph edge metadata when triggered by a
  workflow.
- `list_tasks` should remain compatible with status views.

### 5. Observation Nodes

Current nodes:

- `browser`
- `git`
- `status`

Target role:

Observation nodes inspect the outside world and emit typed findings.

Direction:

- `browser` should emit `browser_finding_out`, `screenshot_ref_out`, and
  `console_issue_out`.
- `git` should emit `diff_out`, `branch_out`, `worktree_out`, and
  `dirty_file_out`.
- `status` should remain an aggregate observer, with optional outputs such as
  `blocked_task_out` and `claim_conflict_out`.

Contex impact:

- File claims can become `FileClaim` payloads.
- Browser findings and Git diffs can become context attachments.

### 6. Integration Nodes

Current representation:

- Contex `extension` tile type
- Polly integration domain/tools

Target role:

External systems should appear as typed integration nodes.

Direction:

- Define an Integration Observer base contract.
- Polly Daemon becomes an observer/control node.
- Polly Item becomes a task/review node projection.
- Polly action requests become typed payloads, not generic button actions.

Suggested Polly contracts:

```text
PollyRegistryObserver.snapshot_in
PollyRegistryObserver.item_task_out
PollyRegistryObserver.human_attention_out

PollyItem.status_out
PollyItem.worktree_out
PollyItem.review_request_out

PollyActionRequest.request_in
PollyActionRequest.result_out
```

Contex impact:

- `polly_sync_snapshot` should include graph node metadata where possible.
- `polly_request_action` should map to typed `OperatorRequest` payloads.
- Polly remains the owner of registry mutation.

## Function-To-Node Migration

Many current features are endpoint/tool functions. Blueprint direction should
make them graph-visible over time.

| Current function | Future node or port |
| --- | --- |
| `agent_send_message` | `Agent.message_out -> Agent.message_in` |
| `agent_request_handoff` | `Agent.handoff_out -> Agent.task_in/message_in` |
| `agent_report` | `Agent.report_out -> Agent.message_in` |
| `agent_request_human_input` | `Agent.human_attention_out -> Human.question_in` |
| `create_task` | `CreateTaskNode.task_out` |
| `update_task` | `Task.task_update_in` |
| `terminal_send_input` | `Terminal.stdin_in` |
| `canvas_create_tile` | `GraphRuntime.create_node` |
| `canvas_connect` | `GraphRuntime.create_edge` |
| `get_workspace_timeline` | `Debugger.timeline_in` |
| `polly_sync_snapshot` | `PollyRegistryObserver.snapshot_in` |

## Data Model Direction

### Node Contract

First implementation can be static JS metadata in CodeSurf:

```js
{
  type: 'agent',
  family: 'execution',
  inputs: [
    { id: 'message_in', type: 'AgentMessage' },
    { id: 'task_in', type: 'Task' },
    { id: 'context_in', type: 'ContextBundle' }
  ],
  outputs: [
    { id: 'report_out', type: 'AgentReport' },
    { id: 'handoff_out', type: 'HandoffRequest' }
  ],
  actions: ['claim', 'complete', 'handoff', 'report', 'broadcast']
}
```

### Typed Link

Backward-compatible link shape:

```js
{
  id,
  source,
  target,
  directed,
  kind,
  syncStatus,
  source_port,
  target_port,
  lane,
  payload_type
}
```

Old fields remain required. New fields are optional until BP-2/BP-3.

### Runtime Event

Contex audit/timeline events should grow optional graph fields:

```js
{
  node_id,
  port_id,
  edge_id,
  workflow_template_id,
  workflow_instance_id,
  payload_type,
  payload_summary
}
```

## Frontend Direction

Do not immediately convert the whole UI to visible ports. Use progressive
disclosure:

1. Existing simple tile-to-tile links remain default.
2. Node inspector shows contract and compatible outputs.
3. Advanced mode shows ports.
4. Dragging from a port creates a typed edge.
5. Invalid edge attempts explain the type mismatch.

## Backend Direction

Contex should stay backward-compatible:

- Existing tools keep accepting tile ids.
- Existing `link_tiles` works without ports.
- Existing timelines work without graph metadata.
- New graph fields are optional.

Then add stricter behavior only when a workflow opts into typed graph mode.

## Polly Direction

Polly changes should remain observe/assist first:

- CodeSurf visualizes Polly as nodes.
- Contex records Polly snapshots, tasks, claims, and operator requests.
- Polly consumes requests and mutates its own registry.
- Full control mode is deferred.

Blueprint-specific Polly outputs should include:

```text
PollyItemReadyForReview
PollyItemBlocked
PollyWorktreeClaim
PollyMergeReady
PollyActionResult
```

## Migration Sequence

Recommended order:

1. Add CodeSurf node contracts only.
2. Add docs/tests for contract inventory.
3. Add link validation using contracts, still tile-to-tile.
4. Add optional link metadata fields.
5. Mirror optional link metadata to Contex.
6. Add node inspector contract display.
7. Add minimal port UI for Agent and Document.
8. Add runtime event metadata for messages/handoff/report.
9. Convert workflow presets into workflow templates.
10. Add Polly node contracts.

## Risks

- Making port UI too early could make the product feel like a low-level tool.
- Over-strict type validation could block useful Agent improvisation.
- Contex schema changes could break existing MCP clients if not optional.
- Polly integration could accidentally become control-plane mutation; keep
  observe/assist boundaries explicit.
- Agent nodes may become too bloated if routing/gates are not split out.

## Success Criteria

The Blueprint direction is working when:

- A user can inspect a node and understand inputs, outputs, state, and actions.
- Invalid links are caught before runtime.
- A timeline event can highlight the node and edge that produced it.
- A reusable workflow can create the same graph repeatedly.
- Agent, Human, Task, Document, Browser, Terminal, and Polly flows share the
  same graph vocabulary.
