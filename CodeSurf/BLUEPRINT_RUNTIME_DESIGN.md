# CodeSurf Blueprint Runtime Design

> This file is the original design draft. The organized Blueprint Runtime track
> now lives in `blueprint-runtime/`, `CodeSurf/blueprint-runtime/`, and
> `Contex/blueprint-runtime/`.

## Purpose

This document captures the design shift required for CodeSurf and Contex to move
from an infinite-canvas coordination app toward a Blueprint-like visual runtime,
in the spirit of Unity Visual Scripting and Unreal Engine Blueprints.

The goal is not to imitate their UI surface. The goal is to adopt the deeper
model: a graph of typed, executable, inspectable nodes whose connections carry
well-defined control, data, and collaboration payloads.

## Core Reframe

Current mental model:

```text
CodeSurf = visual multi-agent canvas
Contex   = coordination backend
```

Target mental model:

```text
CodeSurf = multi-agent workflow blueprint editor
Contex   = graph runtime + message bus + state machine + audit log
```

This means every new feature should answer:

- What node type does this create or extend?
- What typed inputs and outputs does it expose?
- What can trigger it?
- What does it emit?
- How does it fail, pause, retry, or ask for human input?
- How does timeline/audit map back to node, port, and link?
- Can this graph or subgraph be saved as a reusable asset?

## Design Principles

### 1. Nodes Are Executable Units, Not Cards

A CodeSurf tile should become the visual shell for a runtime node. A node has a
contract:

```text
Node = type + inputs + outputs + state + execution rule + audit identity
```

Example Agent contract:

```text
inputs:
  message: AgentMessage
  task: Task
  context: ContextBundle
  human_reply: HumanReply

outputs:
  message: AgentMessage
  report: AgentReport
  handoff: HandoffRequest
  human_attention: HumanAttention
  task_update: TaskUpdate

state:
  offline | idle | working | waiting | blocked | paused | done | error
```

The UI can remain compact, but the runtime needs the contract.

### 2. Links Carry Typed Things

Today, CodeSurf links mostly express relationships such as `controls`,
`handoff`, and `reports_to`. Blueprint-style graphs require links to carry
specific payloads.

Initial link lanes:

```text
control    ordering and authority: controls, handoff, reports_to
message    AgentMessage / ChatMessage
task       Task / TaskUpdate / Claim
context    ContextBundle / DocumentSelection / MemoryFact
resource   FileClaim / TerminalInput / BrowserFinding
human      HumanAttention / HumanReply / Approval
```

The UI may still show simple semantic labels, but internally a link should know
what it transports and which ports it connects.

### 3. Ports Need Types

Blueprints work because many invalid connections are impossible. CodeSurf needs
the same guardrail.

Example port compatibility:

```text
Agent.outputs.report        -> Agent.inputs.message        ok
Document.outputs.selection  -> Agent.inputs.context        ok
Browser.outputs.finding     -> Reviewer.inputs.review_item ok
Git.outputs.diff            -> Agent.inputs.context        ok
TaskRouter.outputs.task     -> Agent.inputs.task           ok
HumanGate.outputs.approval  -> Agent.inputs.human_reply    ok

Status.outputs.summary      -> Terminal.inputs.stdin       not ok by default
HumanAttention              -> GitBranch                   not ok
```

Type checking should happen at graph-edit time and again at runtime.

### 4. Control Flow And Data Flow Are Different

Unreal distinguishes execution wires from data wires. CodeSurf should not force
one link concept to do all work.

Recommended split:

```text
execution/control edge:
  starts, blocks, hands off, retries, cancels

data/message edge:
  transports payloads such as messages, tasks, documents, findings
```

A single visible connection can bundle both, but the internal model should keep
them distinct.

### 5. Workflows Are First-Class Assets

A workflow is not just a group of tiles. It should be a versioned graph asset:

```text
WorkflowTemplate
  nodes
  ports
  links
  defaults
  validation rules
  display layout

WorkflowInstance
  template reference
  runtime state
  event history
  current payloads
```

Examples:

- Coordinator -> Worker -> Reviewer
- Parallel Workers -> Merge -> Reviewer
- Browser QA -> Bug Fix Agent -> Test Runner -> Human Approval
- Polly Registry Observer -> Reviewer -> Human Merge Gate

### 6. Debugging Is Part Of The Product

Blueprint systems are valuable because they are inspectable while running.

CodeSurf should provide:

- active node highlighting
- recently fired edge highlighting
- per-port last payload preview
- node execution history
- failure reason pinned to the node and edge
- timeline replay mapped to node/port/link ids
- diff between expected and actual payload type
- retry, skip, pause, and resume controls

Contex already has timeline and audit primitives. The next step is to include
graph coordinates in those events:

```text
node_id
port_id
edge_id
payload_type
payload_summary
workflow_instance_id
```

### 7. Agents Are Nodes, Not The Whole System

Agent nodes are important, but a Blueprint-style CodeSurf should avoid putting
all workflow logic inside Agent panels.

Some functions deserve separate nodes:

```text
Receive Message
Create Task
Assign Agent
Run Agent
Wait For Result
Review Result
Ask Human
Run Tests
Collect Browser Finding
Read Git Diff
Write Document
Commit Memory
Route By Status
Merge Context
```

Agent nodes should reason and act. Workflow nodes should route, gate, transform,
and debug.

## Proposed Node Families

### Human And Planning

| Node | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| Human Input | question, context | human_reply, approval | Ask the human for a decision. |
| Objective | markdown, rules | objective | Define work intent. |
| Plan | objective, context | task_graph | Produce or hold a work plan. |

### Agent Runtime

| Node | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| Agent | message, task, context | message, report, handoff, human_attention | Autonomous runtime worker. |
| Agent Router | task, selector | assigned_agent | Choose a target agent. |
| Agent Gate | agent_state | continue, wait, fail | Route based on state. |

### Work And Review

| Node | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| Task | title, owner, status | task_update | Represent durable work. |
| Review Gate | result, criteria | approved, changes_requested | Decide whether work passes. |
| Test Runner | command, repo | test_result, logs | Execute verification. |

### Context And Artifacts

| Node | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| Document | text, selection | document_context, selection | Store specs, plans, reports. |
| Memory | events, facts | memory_fact, proposal | Maintain durable context. |
| Git | repo | diff, branch, worktree | Surface repository state. |
| Browser | url | browser_finding, screenshot_ref | Inspect web/app behavior. |

### Integration

| Node | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| Polly Observer | registry_snapshot | polly_task, human_attention | Observe Polly runs. |
| Webhook | event | request, response | External automation bridge. |
| MCP Tool | tool_args | tool_result, error | Wrap a Contex or external MCP tool. |

## Runtime Responsibilities

### CodeSurf

CodeSurf owns the editor and visualization:

- graph editing
- node layout
- node chrome and inspectors
- port rendering
- graph validation UI
- workflow templates
- live edge and node highlighting
- local process hosting for terminal/agent nodes

### Contex

Contex owns runtime truth:

- node identity and state machine
- typed message bus
- link/edge policy
- task state
- human attention
- file claims
- audit/timeline
- command queue from Agents to CodeSurf
- replay/export/import of runtime state

## Incremental Roadmap

### Phase 1: Node Contracts

Add a contract registry for CodeSurf tile types:

```text
type
inputs[]
outputs[]
state schema
actions[]
runtime mapping
```

Do not change the UI much yet. Use contracts to power tooltips, validation, and
documentation.

### Phase 2: Typed Links

Extend link data:

```text
source_node
source_port
target_node
target_port
lane
payload_type
semantic_kind
directed
```

Keep tile-to-tile links as a simple mode, but store enough data for port-level
links.

### Phase 3: Port UI

Expose input/output ports on nodes. Start with high-value ports:

- Agent: message in/out, task in/out, context in, human_attention out
- Document: selection/context out
- Browser: finding out
- Status: task/status out
- Terminal: stdin in, stdout out

### Phase 4: Runtime Event Mapping

Attach `node_id`, `port_id`, `edge_id`, and `payload_type` to Contex audit and
timeline events where applicable.

### Phase 5: Workflow Assets

Persist workflows as reusable assets, with subgraphs and presets becoming the
same underlying concept.

### Phase 6: Visual Debugging

Add runtime replay:

- step through events
- highlight fired edges
- inspect payloads
- show blocked/error paths
- replay one workflow instance without mutating state

## Design Review Checklist

For every new feature, answer:

- Which node type owns this capability?
- Is it a runtime node, editor-only node, or integration node?
- What input ports does it require?
- What output ports does it emit?
- What payload types cross its ports?
- What link lanes are allowed?
- What state transitions are legal?
- What does failure look like?
- What timeline/audit event proves it happened?
- Can it be used inside a reusable workflow template?

If these questions cannot be answered, the feature is still a panel/button, not
yet a Blueprint-style node.
