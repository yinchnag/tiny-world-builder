// -------- tasks: larger-grained work with a lifecycle --------
// Distinct from todos (lightweight peer assignments): a task carries status,
// owner, blocker, version, and history. A task belongs to a `channel` (a tile
// id or the workspace) so per-channel views are possible. Transitions follow
// the DATA_MODEL.md section 4 state machine; invalid ones raise
// CONTEXT_INVALID_TRANSITION, concurrent edits raise CONTEXT_VERSION_CONFLICT.

import { newTaskId } from '../ids.mjs';
import { nowIso, audit } from '../store.mjs';
import { err } from '../errors.mjs';

export const TASK_STATUSES = new Set([
  'open', 'assigned', 'in_progress', 'review', 'done', 'paused', 'blocked', 'cancelled',
]);

const TASK_TRANSITIONS = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'paused', 'blocked', 'cancelled'],
  in_progress: ['review', 'paused', 'blocked', 'cancelled'],
  review: ['done', 'in_progress', 'cancelled'],
  paused: ['in_progress', 'assigned', 'cancelled'],
  blocked: ['in_progress', 'assigned', 'cancelled'],
  done: [],
  cancelled: [],
};

export function isValidTaskTransition(from, to) {
  if (!TASK_STATUSES.has(to)) return false;
  if (from === to) return true;
  return (TASK_TRANSITIONS[from] || []).includes(to);
}

export function createTask(db, { workspace_id, channel = null, title, description = null, priority = 'normal', creator_tile_id = null, owner_tile_id = null }, opts = {}) {
  const { clock, correlation_id } = opts;
  if (!title) throw err.badRequest('title is required');
  const id = newTaskId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO task (id, workspace_id, channel, title, description, status, priority, owner_tile_id, creator_tile_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 1, ?, ?)`
  ).run(id, workspace_id, channel, title, description, priority, owner_tile_id, creator_tile_id, ts, ts);
  auditTask(db, ts, workspace_id, creator_tile_id, id, 'created', { title, channel, owner_tile_id, creator_tile_id, status: 'open' }, correlation_id ?? null);
  return getTask(db, id);
}

export function updateTask(db, { task_id, status, owner_tile_id, blocker, result_summary, priority, expected_version, actor_tile_id }, opts = {}) {
  const { clock, correlation_id } = opts;
  const row = db.prepare(`SELECT * FROM task WHERE id = ?`).get(task_id);
  if (!row) throw err.badRequest(`Unknown task: ${task_id}`);
  if (expected_version != null && expected_version !== row.version) throw err.versionConflict(expected_version, row.version);

  const nextStatus = status ?? row.status;
  if (status && !isValidTaskTransition(row.status, status)) throw err.invalidTransition(row.status, status);

  const newOwner = owner_tile_id !== undefined ? owner_tile_id : row.owner_tile_id;
  let newBlocker = row.blocker;
  if (blocker !== undefined) newBlocker = blocker;
  else if (['in_progress', 'assigned', 'review', 'done'].includes(nextStatus)) newBlocker = null; // resuming clears the blocker
  const newSummary = result_summary !== undefined ? result_summary : row.result_summary;
  const newPriority = priority !== undefined ? priority : row.priority;
  const completedAt = nextStatus === 'done' ? nowIso(clock) : row.completed_at;
  const ts = nowIso(clock);

  db.prepare(
    `UPDATE task SET status=?, owner_tile_id=?, blocker=?, result_summary=?, priority=?, version=?, updated_at=?, completed_at=? WHERE id=?`
  ).run(nextStatus, newOwner, newBlocker, newSummary, newPriority, row.version + 1, ts, completedAt, task_id);

  auditTask(db, ts, row.workspace_id, actor_tile_id ?? null, task_id, 'updated', {
    status: nextStatus,
    owner_tile_id: newOwner,
    blocker: newBlocker,
    result_summary: newSummary,
    priority: newPriority,
  }, correlation_id ?? null);
  return getTask(db, task_id);
}

// pause_task: transition to paused, storing the reason as the blocker.
export function pauseTask(db, { task_id, reason = null, actor_tile_id }, opts = {}) {
  return updateTask(db, { task_id, status: 'paused', blocker: reason, actor_tile_id }, opts);
}

export function getTask(db, id) {
  const row = db.prepare(`SELECT * FROM task WHERE id = ?`).get(id);
  return row ? mapTask(row) : null;
}

// listTasks with an optional channel filter (per-channel views / task scope).
export function listTasks(db, workspaceId, { channel } = {}) {
  const rows = channel
    ? db.prepare(`SELECT * FROM task WHERE workspace_id = ? AND channel = ? ORDER BY created_at ASC`).all(workspaceId, channel)
    : db.prepare(`SELECT * FROM task WHERE workspace_id = ? ORDER BY created_at ASC`).all(workspaceId);
  return rows.map(mapTask);
}

// Import a recovered state.json ({ tasks: [...], paused: bool }) as tasks so it
// can be represented through the tasks resource (Phase 5 exit criterion).
export function importTaskState(db, { workspace_id, channel = null, state }, opts = {}) {
  const tasks = (state && Array.isArray(state.tasks)) ? state.tasks : [];
  for (const t of tasks) {
    createTask(db, { workspace_id, channel, title: t.title || t.name || 'imported task', description: t.description ?? null, priority: t.priority || 'normal' }, opts);
  }
  return tasks.length;
}

function auditTask(db, ts, workspaceId, actorId, taskId, action, extra, correlationId = null) {
  audit(db, {
    workspace_id: workspaceId, actor_type: 'tile', actor_id: actorId, tile_id: actorId,
    event_type: `task_${action}`, entity_type: 'task', entity_id: taskId,
    correlation_id: correlationId, payload: extra, created_at: ts,
  });
}

function mapTask(r) {
  return {
    id: r.id, workspace_id: r.workspace_id, channel: r.channel, title: r.title, description: r.description,
    status: r.status, priority: r.priority, owner_tile_id: r.owner_tile_id, creator_tile_id: r.creator_tile_id,
    blocker: r.blocker, result_summary: r.result_summary, version: r.version,
    created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at,
  };
}
