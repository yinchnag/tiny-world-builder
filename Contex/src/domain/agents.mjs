// -------- agents: semantic layer over tile/message primitives --------
// Phase 2 keeps Agent Platform state on the existing tile rows. Agent-specific
// fields are encoded as stable capability markers so no schema migration is
// needed: agent, role:<role>, runtime:<runtime>.

import { setTileState, listTiles, getTile } from './tiles.mjs';
import { sendMessage, readMessages } from './messaging.mjs';
import { getTask, updateTask } from './tasks.mjs';
import { err } from '../errors.mjs';

const AGENT_MARKER = 'agent';
const ROLE_PREFIX = 'role:';
const RUNTIME_PREFIX = 'runtime:';

export function agentRegister(db, input, opts = {}) {
  const agent_id = input.agent_id || input.tile_id;
  const tile_id = input.tile_id || agent_id;
  const runtime = input.runtime || 'custom';
  const role = input.role || 'agent';
  const capabilities = normalizeAgentCapabilities(input.capabilities, { role, runtime });
  const tile = setTileState(db, {
    tile_id,
    workspace_id: input.workspace_id,
    tile_type: input.tile_type || 'terminal',
    status: input.status || 'idle',
    task: input.task ?? null,
    progress: input.progress ?? null,
    summary: input.summary ?? null,
    blocker: input.blocker ?? null,
    title: input.title ?? input.display_name ?? agent_id,
    display_name: input.display_name ?? input.title ?? agent_id,
    branch: input.branch ?? null,
    worktree: input.worktree ?? null,
    client_instance_id: input.client_instance_id ?? null,
    capabilities,
    expected_version: input.expected_version,
  }, opts);
  return mapAgent(tile);
}

export function agentUpdateState(db, input, opts = {}) {
  const agent_id = input.agent_id || input.tile_id;
  const tile_id = input.tile_id || agent_id;
  const current = getTile(db, tile_id, opts);
  const role = input.role ?? current.role ?? markerValue(current.capabilities, ROLE_PREFIX);
  const runtime = input.runtime ?? current.runtime ?? markerValue(current.capabilities, RUNTIME_PREFIX);
  const update = {
    tile_id,
    workspace_id: input.workspace_id || current.workspace_id,
    capabilities: input.capabilities
      ? normalizeAgentCapabilities(input.capabilities, { role, runtime })
      : current.capabilities,
  };
  copyPresent(input, update, [
    'status', 'task', 'progress', 'summary', 'blocker', 'branch', 'worktree',
    'client_instance_id', 'expected_version',
  ]);
  const next = setTileState(db, update, opts);
  return mapAgent(next);
}

export function agentList(db, input = {}, opts = {}) {
  const rows = listTiles(db, input.workspace_id, opts).map(mapAgent).filter((a) => a.is_agent);
  return rows.filter((a) => {
    if (input.role && a.role !== input.role) return false;
    if (input.runtime && a.runtime !== input.runtime) return false;
    if (input.status && a.status !== input.status) return false;
    if (input.capability && !a.capabilities.includes(input.capability)) return false;
    return true;
  });
}

export function agentSendMessage(db, input, opts = {}) {
  const from = input.from_agent_id || input.from_tile_id;
  const to = input.to_agent_id || input.to_tile_id;
  return sendMessage(db, {
    from_tile_id: from,
    to_tile_id: to,
    text: input.text,
    priority: input.priority,
    reply_to: input.reply_to,
    requires_ack: input.requires_ack,
  }, opts);
}

export function agentReadMessages(db, input, opts = {}) {
  return readMessages(db, {
    tile_id: input.agent_id || input.tile_id,
    unread_only: input.unread_only,
    limit: input.limit,
    offset: input.offset,
    acknowledge: input.acknowledge,
  }, opts);
}

export function agentClaimTask(db, input, opts = {}) {
  const agent_id = input.agent_id || input.tile_id;
  if (!agent_id) throw err.badRequest('agent_id is required');
  const task = requiredTask(db, input.task_id);
  if (task.owner_tile_id && task.owner_tile_id !== agent_id && task.status !== 'open') {
    throw err.badRequest(`task is already owned by ${task.owner_tile_id}`);
  }
  const requested = input.status || (task.status === 'assigned' ? 'in_progress' : 'assigned');
  const status = task.status === requested ? undefined : requested;
  return updateTask(db, {
    task_id: task.id,
    status,
    owner_tile_id: agent_id,
    expected_version: input.expected_version,
    actor_tile_id: agent_id,
  }, opts);
}

export function agentCompleteTask(db, input, opts = {}) {
  const agent_id = input.agent_id || input.tile_id;
  if (!agent_id) throw err.badRequest('agent_id is required');
  let task = requiredTask(db, input.task_id);
  if (task.owner_tile_id && task.owner_tile_id !== agent_id) {
    throw err.badRequest(`task is owned by ${task.owner_tile_id}`);
  }
  if (task.status === 'cancelled') throw err.badRequest('cancelled tasks cannot be completed');
  if (task.status === 'done') return task;

  const path = completionPath(task.status);
  let expected_version = input.expected_version;
  for (const status of path) {
    task = updateTask(db, {
      task_id: task.id,
      status,
      owner_tile_id: agent_id,
      result_summary: status === 'done' ? input.result_summary : undefined,
      expected_version,
      actor_tile_id: agent_id,
    }, opts);
    expected_version = undefined;
  }
  return task;
}

export function agentRequestHandoff(db, input, opts = {}) {
  const from_agent_id = input.from_agent_id || input.from_tile_id;
  const to_agent_id = input.to_agent_id || input.to_tile_id;
  if (!from_agent_id) throw err.badRequest('from_agent_id is required');
  if (!to_agent_id) throw err.badRequest('to_agent_id is required');
  let task = null;
  if (input.task_id) {
    requiredTask(db, input.task_id);
    task = updateTask(db, {
      task_id: input.task_id,
      owner_tile_id: to_agent_id,
      blocker: input.blocker,
      actor_tile_id: from_agent_id,
    }, opts);
  }
  const message = sendMessage(db, {
    from_tile_id: from_agent_id,
    to_tile_id: to_agent_id,
    text: input.text || defaultHandoffText(input.task_id),
    priority: input.priority,
    requires_ack: input.requires_ack ?? true,
  }, opts);
  return { task, message };
}

export function agentReport(db, input, opts = {}) {
  const from_agent_id = input.from_agent_id || input.from_tile_id;
  const to_agent_id = input.to_agent_id || input.to_tile_id;
  if (!from_agent_id) throw err.badRequest('from_agent_id is required');
  if (!to_agent_id) throw err.badRequest('to_agent_id is required');
  let task = null;
  if (input.task_id && input.result_summary !== undefined) {
    requiredTask(db, input.task_id);
    task = updateTask(db, {
      task_id: input.task_id,
      result_summary: input.result_summary,
      actor_tile_id: from_agent_id,
    }, opts);
  }
  const message = sendMessage(db, {
    from_tile_id: from_agent_id,
    to_tile_id: to_agent_id,
    text: input.text,
    priority: input.priority,
    reply_to: input.reply_to,
    requires_ack: input.requires_ack,
  }, opts);
  return { task, message };
}

export function agentBroadcast(db, input, opts = {}) {
  const from_agent_id = input.from_agent_id || input.from_tile_id;
  if (!from_agent_id) throw err.badRequest('from_agent_id is required');
  const selector = input.selector || {};
  const recipients = agentList(db, {
    workspace_id: input.workspace_id,
    role: selector.role ?? input.role,
    runtime: selector.runtime ?? input.runtime,
    status: selector.status ?? input.status,
    capability: selector.capability ?? input.capability,
  }, opts).filter((a) => a.agent_id !== from_agent_id);
  const results = [];
  for (const recipient of recipients) {
    try {
      const message = sendMessage(db, {
        from_tile_id: from_agent_id,
        to_tile_id: recipient.agent_id,
        text: input.text,
        priority: input.priority,
        requires_ack: input.requires_ack,
      }, opts);
      results.push({ agent_id: recipient.agent_id, delivered: true, message });
    } catch (e) {
      results.push({ agent_id: recipient.agent_id, delivered: false, error: e.code || e.message });
    }
  }
  return {
    recipients: results,
    delivered: results.filter((r) => r.delivered).length,
    failed: results.filter((r) => !r.delivered).length,
  };
}

export function mapAgent(tile) {
  const capabilities = Array.isArray(tile.capabilities) ? tile.capabilities : [];
  const role = markerValue(capabilities, ROLE_PREFIX);
  const runtime = markerValue(capabilities, RUNTIME_PREFIX);
  return {
    agent_id: tile.tile_id,
    tile_id: tile.tile_id,
    workspace_id: tile.workspace_id,
    runtime,
    role,
    display_name: tile.display_name || tile.title || tile.tile_id,
    status: tile.status,
    reported_status: tile.reported_status,
    online: tile.online,
    task: tile.task,
    progress: tile.progress,
    summary: tile.summary,
    blocker: tile.blocker,
    branch: tile.branch,
    worktree: tile.worktree,
    capabilities: publicCapabilities(capabilities),
    version: tile.version,
    last_seen_at: tile.last_seen_at,
    updated_at: tile.updated_at,
    is_agent: capabilities.includes(AGENT_MARKER),
  };
}

function requiredTask(db, task_id) {
  if (!task_id) throw err.badRequest('task_id is required');
  const task = getTask(db, task_id);
  if (!task) throw err.badRequest(`Unknown task: ${task_id}`);
  return task;
}

function completionPath(status) {
  if (status === 'open') return ['assigned', 'in_progress', 'review', 'done'];
  if (status === 'assigned') return ['in_progress', 'review', 'done'];
  if (status === 'in_progress') return ['review', 'done'];
  if (status === 'review') return ['done'];
  if (status === 'paused' || status === 'blocked') return ['in_progress', 'review', 'done'];
  return [];
}

function defaultHandoffText(task_id) {
  return task_id ? `Handoff requested for task ${task_id}` : 'Handoff requested';
}

function normalizeAgentCapabilities(capabilities = [], { role, runtime } = {}) {
  const out = new Set([AGENT_MARKER]);
  if (role) out.add(`${ROLE_PREFIX}${role}`);
  if (runtime) out.add(`${RUNTIME_PREFIX}${runtime}`);
  for (const c of Array.isArray(capabilities) ? capabilities : []) {
    if (typeof c !== 'string' || !c) continue;
    if (c === AGENT_MARKER || c.startsWith(ROLE_PREFIX) || c.startsWith(RUNTIME_PREFIX)) continue;
    out.add(c);
  }
  return [...out];
}

function markerValue(capabilities, prefix) {
  const found = (Array.isArray(capabilities) ? capabilities : []).find((c) => typeof c === 'string' && c.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function publicCapabilities(capabilities) {
  return (Array.isArray(capabilities) ? capabilities : []).filter((c) => (
    c !== AGENT_MARKER && !c.startsWith(ROLE_PREFIX) && !c.startsWith(RUNTIME_PREFIX)
  ));
}

function copyPresent(from, to, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(from, key)) to[key] = from[key];
  }
}
