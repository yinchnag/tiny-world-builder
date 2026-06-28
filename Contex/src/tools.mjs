// -------- MCP tool layer --------
// Maps MCP tool names onto the Contex facade, applies idempotency to mutating
// tools, and exposes a tools/list catalog. Round 1 ships the peer_* coordination
// loop plus link_tiles (the canvas-edge operation CodeSurf will own later, used
// headless here to wire the peer graph).

import { getIdempotent, putIdempotent, nowIso } from './store.mjs';
import { err, ErrorCodes } from './errors.mjs';
import { newId as _newId } from './ids.mjs';
const newCallId = () => _newId('call');

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const workspaceId = (c, a = {}) => a.workspace_id || c.soleWorkspace()?.id;

export const TOOLS = [
  {
    name: 'peer_set_state',
    description: 'Register a tile or update its presence (status, task, files, branch). Optimistic concurrency via expected_version; file[] declares claims.',
    inputSchema: obj({
      tile_id: { type: 'string' },
      tile_type: { type: 'string' },
      status: { type: 'string' },
      task: { type: 'string' },
      progress: { type: 'string' },
      files: { type: 'array' },
      branch: { type: 'string' },
      worktree: { type: 'string' },
      summary: { type: 'string' },
      blocker: { type: 'string' },
      expected_version: { type: 'number' },
      idempotency_key: { type: 'string' },
      workspace_id: { type: 'string' },
    }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.setState(a),
  },
  {
    name: 'peer_get_state',
    description: "Read a tile's own state plus its linked peers (with each peer's available tools) and any file-claim conflicts.",
    inputSchema: obj({
      tile_id: { type: 'string' },
      include_workspace: { type: 'boolean' },
      include_offline: { type: 'boolean' },
    }, ['tile_id']),
    handler: (c, a) => c.getState(a),
  },
  {
    name: 'peer_send_message',
    description: 'Send a direct message to a linked peer tile. Persisted before delivery; requires a canvas link between the tiles.',
    inputSchema: obj({
      from_tile_id: { type: 'string' },
      to_tile_id: { type: 'string' },
      text: { type: 'string' },
      priority: { type: 'string' },
      reply_to: { type: 'string' },
      requires_ack: { type: 'boolean' },
      idempotency_key: { type: 'string' },
    }, ['from_tile_id', 'to_tile_id', 'text']),
    mutates: true,
    handler: (c, a) => c.sendMessage(a),
  },
  {
    name: 'peer_read_messages',
    description: 'Read messages addressed to a tile (unread-only by default), marking them delivered/read; optionally acknowledge.',
    inputSchema: obj({
      tile_id: { type: 'string' },
      unread_only: { type: 'boolean' },
      limit: { type: 'number' },
      offset: { type: 'number' },
      acknowledge: { type: 'boolean' },
    }, ['tile_id']),
    handler: (c, a) => ({ messages: c.readMessages(a) }),
  },
  {
    name: 'chat_send_message',
    description: 'Send a human-readable message to a chat tile. Requires a canvas link; target must be a chat tile.',
    inputSchema: obj({
      from_tile_id: { type: 'string' },
      to_tile_id: { type: 'string' },
      text: { type: 'string' },
      priority: { type: 'string' },
      requires_ack: { type: 'boolean' },
      reply_to: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['from_tile_id', 'to_tile_id', 'text']),
    mutates: true,
    handler: (c, a) => c.chatSendMessage(a),
  },
  {
    name: 'chat_acknowledge',
    description: 'Acknowledge receipt or completion of a message addressed to this tile.',
    inputSchema: obj({
      message_id: { type: 'string' },
      tile_id: { type: 'string' },
    }, ['message_id']),
    mutates: true,
    handler: (c, a) => c.acknowledgeMessage(a),
  },
  {
    name: 'notify',
    description: "Create a workspace notification. level 'human_attention' raises a flag for the human.",
    inputSchema: obj({
      level: { type: 'string' },
      text: { type: 'string' },
      tile_id: { type: 'string' },
      workspace_id: { type: 'string' },
    }, ['text']),
    mutates: true,
    handler: (c, a) => c.notify(a),
  },
  // agent semantic API (Agent Platform Upgrade Phase 2). These tools wrap the
  // existing peer/message/link primitives without changing the storage model.
  {
    name: 'agent_register',
    description: 'Register an agent identity backed by a Contex tile. Stores role/runtime as semantic capability markers.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      tile_id: { type: 'string' },
      runtime: { type: 'string' },
      role: { type: 'string' },
      display_name: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      task: { type: 'string' },
      progress: { type: 'string' },
      summary: { type: 'string' },
      blocker: { type: 'string' },
      capabilities: { type: 'array' },
      branch: { type: 'string' },
      worktree: { type: 'string' },
      client_instance_id: { type: 'string' },
      expected_version: { type: 'number' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['agent_id']),
    mutates: true,
    handler: (c, a) => c.agentRegister(a),
  },
  {
    name: 'agent_update_state',
    description: 'Update an agent status/task/progress/summary without exposing the lower-level peer_set_state schema.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      tile_id: { type: 'string' },
      status: { type: 'string' },
      task: { type: 'string' },
      progress: { type: 'string' },
      summary: { type: 'string' },
      blocker: { type: 'string' },
      role: { type: 'string' },
      runtime: { type: 'string' },
      capabilities: { type: 'array' },
      branch: { type: 'string' },
      worktree: { type: 'string' },
      client_instance_id: { type: 'string' },
      expected_version: { type: 'number' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['agent_id']),
    mutates: true,
    handler: (c, a) => c.agentUpdateState(a),
  },
  {
    name: 'agent_list',
    description: 'List registered agents in a workspace, optionally filtered by role, runtime, status, or capability.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      role: { type: 'string' },
      runtime: { type: 'string' },
      status: { type: 'string' },
      capability: { type: 'string' },
    }),
    handler: (c, a) => ({ agents: c.agentList(a) }),
  },
  {
    name: 'list_peers',
    description: 'Compatibility view for CodeSurf status panels. Returns registered agents as peers.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      role: { type: 'string' },
      runtime: { type: 'string' },
      status: { type: 'string' },
      capability: { type: 'string' },
    }),
    handler: (c, a) => ({ peers: c.agentList(a) }),
  },
  {
    name: 'agent_send_message',
    description: 'Send a link-gated message from one agent to another agent/tile.',
    inputSchema: obj({
      from_agent_id: { type: 'string' },
      to_agent_id: { type: 'string' },
      text: { type: 'string' },
      priority: { type: 'string' },
      reply_to: { type: 'string' },
      requires_ack: { type: 'boolean' },
      idempotency_key: { type: 'string' },
    }, ['from_agent_id', 'to_agent_id', 'text']),
    mutates: true,
    handler: (c, a) => c.agentSendMessage(a),
  },
  {
    name: 'agent_read_messages',
    description: 'Read messages addressed to an agent, marking them delivered/read and optionally acknowledged.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      unread_only: { type: 'boolean' },
      limit: { type: 'number' },
      offset: { type: 'number' },
      acknowledge: { type: 'boolean' },
    }, ['agent_id']),
    handler: (c, a) => ({ messages: c.agentReadMessages(a) }),
  },
  {
    name: 'agent_claim_task',
    description: 'Claim an open/assigned task for an agent, optionally moving it into progress.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      task_id: { type: 'string' },
      status: { type: 'string' },
      expected_version: { type: 'number' },
      idempotency_key: { type: 'string' },
    }, ['agent_id', 'task_id']),
    mutates: true,
    handler: (c, a) => c.agentClaimTask(a),
  },
  {
    name: 'agent_complete_task',
    description: 'Complete a task for an agent, walking the task lifecycle through review to done as needed.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      task_id: { type: 'string' },
      result_summary: { type: 'string' },
      expected_version: { type: 'number' },
      idempotency_key: { type: 'string' },
    }, ['agent_id', 'task_id']),
    mutates: true,
    handler: (c, a) => c.agentCompleteTask(a),
  },
  {
    name: 'agent_request_handoff',
    description: 'Hand a task or context from one agent to another linked agent, updating owner and sending an ack-required message.',
    inputSchema: obj({
      from_agent_id: { type: 'string' },
      to_agent_id: { type: 'string' },
      task_id: { type: 'string' },
      text: { type: 'string' },
      blocker: { type: 'string' },
      priority: { type: 'string' },
      requires_ack: { type: 'boolean' },
      idempotency_key: { type: 'string' },
    }, ['from_agent_id', 'to_agent_id']),
    mutates: true,
    handler: (c, a) => c.agentRequestHandoff(a),
  },
  {
    name: 'agent_report',
    description: 'Report progress or results from one linked agent to another agent/tile, optionally updating a task result summary.',
    inputSchema: obj({
      from_agent_id: { type: 'string' },
      to_agent_id: { type: 'string' },
      task_id: { type: 'string' },
      text: { type: 'string' },
      result_summary: { type: 'string' },
      priority: { type: 'string' },
      reply_to: { type: 'string' },
      requires_ack: { type: 'boolean' },
      idempotency_key: { type: 'string' },
    }, ['from_agent_id', 'to_agent_id', 'text']),
    mutates: true,
    handler: (c, a) => c.agentReport(a),
  },
  {
    name: 'agent_broadcast',
    description: 'Broadcast a link-gated message from one agent to agents selected by role/runtime/status/capability.',
    inputSchema: obj({
      from_agent_id: { type: 'string' },
      text: { type: 'string' },
      selector: { type: 'object' },
      role: { type: 'string' },
      runtime: { type: 'string' },
      status: { type: 'string' },
      capability: { type: 'string' },
      priority: { type: 'string' },
      requires_ack: { type: 'boolean' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['from_agent_id', 'text']),
    mutates: true,
    handler: (c, a) => c.agentBroadcast(a),
  },
  {
    name: 'agent_request_human_input',
    description: 'Put an Agent into waiting/blocked state and raise human_attention for a permission issue or major decision.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      tile_id: { type: 'string' },
      question: { type: 'string' },
      text: { type: 'string' },
      reason: { type: 'string' },
      severity: { type: 'string' },
      blocking: { type: 'boolean' },
      status: { type: 'string' },
      task: { type: 'string' },
      summary: { type: 'string' },
      task_id: { type: 'string' },
      task_status: { type: 'string' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['agent_id']),
    mutates: true,
    handler: (c, a) => c.agentRequestHumanInput(a),
  },
  // first-generation task tools. The historical mcp__contex__ prefix is applied
  // by the MCP client (server name + tool name), so server-side names stay bare.
  {
    name: 'create_task',
    description: 'Create a task in a channel (a tile id or the workspace). Starts in status open.',
    inputSchema: obj({
      channel: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string' },
      owner_tile_id: { type: 'string' },
      creator_tile_id: { type: 'string' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['title']),
    mutates: true,
    handler: (c, a) => c.createTask(a),
  },
  {
    name: 'list_tasks',
    description: 'List tasks in a workspace, optionally scoped to one channel/tile.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      channel: { type: 'string' },
    }),
    handler: (c, a) => ({ tasks: c.listTasks(workspaceId(c, a), { channel: a.channel }) }),
  },
  {
    name: 'update_task',
    description: 'Transition a task and/or update its owner, blocker, priority, or result. Optimistic via expected_version.',
    inputSchema: obj({
      channel: { type: 'string' },
      task_id: { type: 'string' },
      status: { type: 'string' },
      owner_tile_id: { type: 'string' },
      blocker: { type: 'string' },
      result_summary: { type: 'string' },
      priority: { type: 'string' },
      expected_version: { type: 'number' },
      actor_tile_id: { type: 'string' },
    }, ['task_id']),
    mutates: true,
    handler: (c, a) => c.updateTask(a),
  },
  {
    name: 'pause_task',
    description: 'Pause a task, storing the reason as its blocker.',
    inputSchema: obj({
      channel: { type: 'string' },
      task_id: { type: 'string' },
      reason: { type: 'string' },
      actor_tile_id: { type: 'string' },
    }, ['task_id']),
    mutates: true,
    handler: (c, a) => c.pauseTask(a),
  },
  {
    name: 'list_file_claims',
    description: 'List active file claims in a workspace for CodeSurf conflict/status panels.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
    }),
    handler: (c, a) => ({ claims: c.listFileClaims(workspaceId(c, a)) }),
  },
  // objectives, skills, context (Phase 7)
  {
    name: 'set_objective',
    description: "Set a tile's objective. Stores a new immutable version and signals the agent to reload. (CodeSurf/owner action.)",
    inputSchema: obj({
      tile_id: { type: 'string' },
      markdown: { type: 'string' },
      rules: { type: 'array' },
      generated_by: { type: 'string' },
    }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.setObjective(a),
  },
  {
    name: 'set_skill',
    description: "Enable or disable a skill for a tile. (CodeSurf/owner action.)",
    inputSchema: obj({
      tile_id: { type: 'string' },
      skill_key: { type: 'string' },
      enabled: { type: 'boolean' },
      source: { type: 'string' },
    }, ['tile_id', 'skill_key']),
    mutates: true,
    handler: (c, a) => c.setSkill(a),
  },
  {
    name: 'add_context_attachment',
    description: 'Attach a context reference (file/url/snippet) to a tile.',
    inputSchema: obj({
      tile_id: { type: 'string' },
      kind: { type: 'string' },
      label: { type: 'string' },
      uri: { type: 'string' },
      content_hash: { type: 'string' },
    }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.addAttachment(a),
  },
  {
    name: 'get_context',
    description: 'Return objective, skills, peers, tasks, and attachment references for a tile.',
    inputSchema: obj({ tile_id: { type: 'string' } }, ['tile_id']),
    handler: (c, a) => c.getContext(a),
  },
  {
    name: 'reload_objective',
    description: "Fetch a tile's latest objective and acknowledge its version.",
    inputSchema: obj({ tile_id: { type: 'string' } }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.reloadObjective(a),
  },
  // canvas command bus (Phase 8) — agent-facing
  {
    name: 'canvas_create_tile',
    description: 'Request CodeSurf to create a child tile. Returns a command id; the new tile id arrives via the command result. For a terminal tile, `command` auto-runs it (e.g. spawn a worker agent); for a document tile, `content` fills it.',
    inputSchema: obj({
      requester_tile_id: { type: 'string' },
      tile_type: { type: 'string' },
      title: { type: 'string' },
      objective: { type: 'string' },
      skills: { type: 'array' },
      position_hint: { type: 'object' },
      link_to_requester: { type: 'boolean' },
      command: { type: 'string' },
      content: { type: 'string' },
    }, ['tile_type']),
    mutates: true,
    handler: (c, a) => c.canvasCreateTile(a),
  },
  {
    name: 'terminal_send_input',
    description: 'Send text or a control action to a terminal tile. Requires a link and the target advertising terminal input; control actions need confirm:true.',
    inputSchema: obj({
      requester_tile_id: { type: 'string' },
      target_tile_id: { type: 'string' },
      text: { type: 'string' },
      control: { type: 'string' },
      confirm: { type: 'boolean' },
    }, ['target_tile_id']),
    mutates: true,
    handler: (c, a) => c.terminalSendInput(a),
  },
  {
    name: 'canvas_focus',
    description: 'Request CodeSurf to focus a tile.',
    inputSchema: obj({ requester_tile_id: { type: 'string' }, tile_id: { type: 'string' } }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.canvasFocus(a),
  },
  {
    name: 'canvas_highlight',
    description: 'Request CodeSurf to highlight a tile for attention.',
    inputSchema: obj({ requester_tile_id: { type: 'string' }, tile_id: { type: 'string' }, reason: { type: 'string' } }, ['tile_id']),
    mutates: true,
    handler: (c, a) => c.canvasHighlight(a),
  },
  {
    name: 'canvas_connect',
    description: 'Request CodeSurf to connect two tiles on the canvas.',
    inputSchema: obj({ requester_tile_id: { type: 'string' }, source_tile_id: { type: 'string' }, target_tile_id: { type: 'string' } }, ['source_tile_id', 'target_tile_id']),
    mutates: true,
    handler: (c, a) => c.canvasConnect(a),
  },
  // canvas command bus — consumer-facing (CodeSurf / owner)
  {
    name: 'canvas_next_commands',
    description: 'Pull pending canvas commands for the workspace (CodeSurf consumer). Marks them delivered.',
    inputSchema: obj({ workspace_id: { type: 'string' }, limit: { type: 'number' } }),
    handler: (c, a) => ({ commands: c.nextCommands(a.workspace_id, { limit: a.limit }) }),
  },
  {
    name: 'canvas_complete_command',
    description: 'Report a canvas command result (CodeSurf consumer). Provide result (e.g. the new tile_id) or error.',
    inputSchema: obj({
      command_id: { type: 'string' },
      result: { type: 'object' },
      error: { type: 'string' },
    }, ['command_id']),
    mutates: true,
    handler: (c, a) => c.completeCommand(a),
  },
  {
    name: 'peer_add_todo',
    description: 'Assign a lightweight todo to a peer tile.',
    inputSchema: obj({
      creator_tile_id: { type: 'string' },
      assignee_tile_id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string' },
      due_at: { type: 'string' },
      workspace_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['title']),
    mutates: true,
    handler: (c, a) => c.addTodo(a),
  },
  {
    name: 'peer_complete_todo',
    description: 'Mark a todo done with an optional result summary.',
    inputSchema: obj({
      todo_id: { type: 'string' },
      completing_tile_id: { type: 'string' },
      result_summary: { type: 'string' },
    }, ['todo_id']),
    mutates: true,
    handler: (c, a) => c.completeTodo(a),
  },
  // Polly Arranger observe-only integration
  {
    name: 'polly_sync_snapshot',
    description: 'Observe-only sync of a Polly Arranger registry snapshot. Upserts Polly items as Contex tasks/tiles and emits human-attention notifications for blocked or ready-for-merge items.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      registry_path: { type: 'string' },
      repo_path: { type: 'string' },
      policy: { type: 'object' },
      vendors: { type: 'array' },
      items: { type: 'array' },
      idempotency_key: { type: 'string' },
    }, ['registry_path', 'items']),
    mutates: true,
    handler: (c, a) => c.syncPollySnapshot(a),
  },
  {
    name: 'polly_request_action',
    description: 'Record an operator request for Polly to consume. This does not mutate the Polly registry; Polly must accept/reject/apply it explicitly.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      registry_path: { type: 'string' },
      registry_hash: { type: 'string' },
      item_id: { type: 'string' },
      action: { type: 'string' },
      reason: { type: 'string' },
      payload: { type: 'object' },
      requested_by_tile_id: { type: 'string' },
      request_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['item_id', 'action']),
    mutates: true,
    handler: (c, a) => c.requestPollyAction(a),
  },
  {
    name: 'polly_list_action_requests',
    description: 'List Polly operator requests recorded in Contex, optionally pending-only or filtered by registry/item/action/status.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      registry_path: { type: 'string' },
      registry_hash: { type: 'string' },
      item_id: { type: 'string' },
      action: { type: 'string' },
      status: { type: 'string' },
      pending_only: { type: 'boolean' },
      since_sequence: { type: 'number' },
      limit: { type: 'number' },
    }),
    handler: (c, a) => c.listPollyActionRequests(a),
  },
  {
    name: 'polly_record_action_result',
    description: 'Record Polly handling of an operator request as accepted, rejected, applied, or failed.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      request_id: { type: 'string' },
      status: { type: 'string' },
      message: { type: 'string' },
      payload: { type: 'object' },
      handled_by_tile_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    }, ['request_id', 'status']),
    mutates: true,
    handler: (c, a) => c.recordPollyActionResult(a),
  },
  // audit + export (Phase 9)
  {
    name: 'export_workspace',
    description: 'Export workspace coordination state as a portable bundle (secrets redacted). Useful for diagnostics and Workspace Memory seeding.',
    inputSchema: obj({ workspace_id: { type: 'string' }, include_audit: { type: 'boolean' }, audit_limit: { type: 'number' } }),
    handler: (c, a) => c.exportWorkspace(a.workspace_id ?? null, a),
  },
  {
    name: 'get_audit_log',
    description: 'Read audit events for a workspace. Supports forward pagination via since_sequence for Workspace Memory event feeds.',
    inputSchema: obj({ workspace_id: { type: 'string' }, limit: { type: 'number' }, since_sequence: { type: 'number' } }),
    handler: (c, a) => ({ events: c.listAuditFeed(a.workspace_id ?? null, a) }),
  },
  // observability (Agent Platform Upgrade Phase 6)
  {
    name: 'get_agent_timeline',
    description: 'Read a normalized status/message/task timeline for one Agent/tile.',
    inputSchema: obj({
      agent_id: { type: 'string' },
      tile_id: { type: 'string' },
      workspace_id: { type: 'string' },
      since_sequence: { type: 'number' },
      limit: { type: 'number' },
    }),
    handler: (c, a) => ({ events: c.listTimeline({ ...a, tile_id: a.tile_id || a.agent_id }) }),
  },
  {
    name: 'get_workspace_timeline',
    description: 'Read a normalized workspace-wide Agent collaboration timeline.',
    inputSchema: obj({
      workspace_id: { type: 'string' },
      since_sequence: { type: 'number' },
      limit: { type: 'number' },
    }),
    handler: (c, a) => ({ events: c.listTimeline(a) }),
  },
  {
    name: 'link_tiles',
    description: 'Create a canvas link between two tiles (peer-graph edge). In the full system this is a CodeSurf/owner action; exposed here to wire peers headless.',
    inputSchema: obj({
      source_tile_id: { type: 'string' },
      target_tile_id: { type: 'string' },
      kind: { type: 'string' },
      directed: { type: 'boolean' },
      workspace_id: { type: 'string' },
    }, ['source_tile_id', 'target_tile_id']),
    mutates: true,
    handler: (c, a) => c.linkTiles(a),
  },
  {
    name: 'unlink_tiles',
    description: 'Remove a canvas link between two tiles.',
    inputSchema: obj({
      source_tile_id: { type: 'string' },
      target_tile_id: { type: 'string' },
      workspace_id: { type: 'string' },
    }, ['source_tile_id', 'target_tile_id']),
    mutates: true,
    handler: (c, a) => ({ unlinked: c.unlinkTiles(a) }),
  },
  // admin-only: scoped client token management (Phase 12)
  {
    name: 'issue_client_token',
    description: 'Issue a new client token with restricted scopes (e.g. ["agent"]). Requires master/admin token.',
    inputSchema: obj({
      scopes: { type: 'array', items: { type: 'string' } },
      ttl_seconds: { type: 'number' },
      label: { type: 'string' },
    }),
    mutates: true,
    adminOnly: true,
    handler: (c, a) => c.issueClientToken({ scopes: a.scopes, ttlSeconds: a.ttl_seconds, label: a.label }),
  },
  {
    name: 'revoke_client_token',
    description: 'Revoke a previously issued client token. Requires master/admin token.',
    inputSchema: obj({ token: { type: 'string' } }, ['token']),
    mutates: true,
    adminOnly: true,
    handler: (c, a) => c.revokeClientToken(a.token),
  },
  {
    name: 'list_client_tokens',
    description: 'List active non-master tokens (prefix only, never the full value). Requires master/admin token.',
    inputSchema: obj({}),
    adminOnly: true,
    handler: (c) => ({ tokens: c.listClientTokens() }),
  },
  // admin-only: legacy .contex/tile-X/ import (Phase 12)
  {
    name: 'import_tile_dir',
    description: 'Import a .contex/tile-X/ directory (state.json, skills.json, objective.md) into the Contex database. Requires master/admin token.',
    inputSchema: obj({
      tile_id: { type: 'string' },
      dir: { type: 'string' },
      workspace_id: { type: 'string' },
    }, ['tile_id', 'dir']),
    mutates: true,
    adminOnly: true,
    handler: (c, a) => c.importTileDir(a),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Returns the tool catalog visible to a caller.
// When authEntry is null (in-process / test call), all tools are shown.
// When authEntry is provided, adminOnly tools are hidden unless the caller
// has '*' or 'admin' scope — so a real MCP client only sees callable tools.
export function toolCatalog(authEntry = null) {
  const isAdmin =
    authEntry == null ||
    authEntry.scopes?.has('*') ||
    authEntry.scopes?.has('admin');
  return TOOLS
    .filter((t) => !t.adminOnly || isAdmin)
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

// Invoke a tool by name. Returns the structured result object. Throws
// ContexError (with a stable .code) on failure; the server maps that to MCP.
//
// Auto-generates a correlation_id per call (or uses one from args) and threads
// it into the facade via _setCallCtx so audit events share a traceable id.
//
// authEntry (Phase 12): the token store entry for the caller. When present,
// adminOnly tools require '*' or 'admin' scope. Pass null to skip the check
// (tests and direct in-process calls are always trusted).
export function callTool(contex, name, args = {}, authEntry = null) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw err.badRequest(`Unknown tool: ${name}`);

  if (tool.adminOnly && authEntry) {
    if (!authEntry.scopes?.has('*') && !authEntry.scopes?.has('admin')) {
      throw err.scopeDenied(`Tool '${name}' requires admin scope`);
    }
  }

  const correlation_id = args.correlation_id || newCallId();
  contex._setCallCtx?.(correlation_id);
  try {
    if (tool.mutates && args.idempotency_key) {
      const cached = getIdempotent(contex.db, args.idempotency_key);
      if (cached) return cached;
      const result = tool.handler(contex, args);
      putIdempotent(contex.db, args.idempotency_key, name, result, nowIso());
      return result;
    }
    return tool.handler(contex, args);
  } finally {
    contex._clearCallCtx?.();
  }
}

export { ErrorCodes };
