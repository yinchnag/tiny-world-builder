// -------- MCP tool layer --------
// Maps MCP tool names onto the Contex facade, applies idempotency to mutating
// tools, and exposes a tools/list catalog. Round 1 ships the peer_* coordination
// loop plus link_tiles (the canvas-edge operation CodeSurf will own later, used
// headless here to wire the peer graph).

import { getIdempotent, putIdempotent, nowIso } from './store.mjs';
import { err, ErrorCodes } from './errors.mjs';

const obj = (properties, required = []) => ({ type: 'object', properties, required });

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
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

// Invoke a tool by name. Returns the structured result object. Throws
// ContexError (with a stable .code) on failure; the server maps that to MCP.
export function callTool(contex, name, args = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw err.badRequest(`Unknown tool: ${name}`);

  if (tool.mutates && args.idempotency_key) {
    const cached = getIdempotent(contex.db, args.idempotency_key);
    if (cached) return cached;
    const result = tool.handler(contex, args);
    putIdempotent(contex.db, args.idempotency_key, name, result, nowIso());
    return result;
  }
  return tool.handler(contex, args);
}

export { ErrorCodes };
