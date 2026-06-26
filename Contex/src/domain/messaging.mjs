// -------- messaging + todos --------
// Direct peer messages and lightweight shared todos. Messages are persisted
// before delivery so an offline/reconnecting tile can still read them
// (FUNCTIONAL_SPEC.md section 4.5). Direct messages require a canvas link
// between the two tiles.

import { newMessageId, newTodoId } from '../ids.mjs';
import { nowIso, audit } from '../store.mjs';
import { getTileRow } from './tiles.mjs';
import { linkedTileIds } from './links.mjs';
import { err } from '../errors.mjs';

export function sendMessage(db, input, { clock } = {}) {
  const { from_tile_id, to_tile_id, text } = input;
  if (!from_tile_id || !to_tile_id || !text) {
    throw err.badRequest('from_tile_id, to_tile_id and text are required');
  }
  const from = getTileRow(db, from_tile_id);
  if (!from) throw err.tileNotFound(from_tile_id);
  const to = getTileRow(db, to_tile_id);
  if (!to) throw err.tileNotFound(to_tile_id);
  // direct messages need a link (peer graph gates communication)
  if (!linkedTileIds(db, from.workspace_id, from_tile_id).includes(to_tile_id)) {
    throw err.peerNotLinked(from_tile_id, to_tile_id);
  }

  const id = newMessageId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO message (id, workspace_id, from_tile_id, to_tile_id, reply_to_id, priority, text, requires_ack, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, from.workspace_id, from_tile_id, to_tile_id, input.reply_to ?? null,
    input.priority ?? 'normal', text, input.requires_ack ? 1 : 0, ts
  );
  audit(db, {
    workspace_id: from.workspace_id, actor_type: 'tile', actor_id: from_tile_id, tile_id: to_tile_id,
    event_type: 'message_sent', entity_type: 'message', entity_id: id,
    payload: { from: from_tile_id, to: to_tile_id, requires_ack: !!input.requires_ack }, created_at: ts,
  });
  return mapMessage(db.prepare(`SELECT * FROM message WHERE id = ?`).get(id));
}

// Priority rank for ordering: urgent first, then high/normal/low, ties broken
// chronologically.
const PRIORITY_RANK = `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END`;

export function readMessages(db, { tile_id, unread_only = true, limit = 50, offset = 0, acknowledge = false }, { clock } = {}) {
  if (!tile_id) throw err.badRequest('tile_id is required');
  const rows = db
    .prepare(
      `SELECT * FROM message
       WHERE to_tile_id = ? ${unread_only ? 'AND read_at IS NULL' : ''}
       ORDER BY ${PRIORITY_RANK} ASC, created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(tile_id, limit, offset);
  const ts = nowIso(clock);
  for (const r of rows) {
    db.prepare(
      `UPDATE message SET delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?) WHERE id = ?`
    ).run(ts, ts, r.id);
    if (acknowledge && r.requires_ack) {
      db.prepare(`UPDATE message SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?`).run(ts, r.id);
    }
  }
  // re-read so returned rows reflect the delivery/read stamps
  return rows.map((r) => mapMessage(db.prepare(`SELECT * FROM message WHERE id = ?`).get(r.id)));
}

export function unreadCount(db, tileId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM message WHERE to_tile_id = ? AND read_at IS NULL`).get(tileId).n;
}

// Recent inbox (read + unread), newest first — backs the context://tile/{id}/inbox resource.
export function listInbox(db, tileId, { limit = 50 } = {}) {
  return db
    .prepare(`SELECT * FROM message WHERE to_tile_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(tileId, limit)
    .map(mapMessage);
}

// -------- chat adapters (Phase 4) --------
// chat_send_message: a human-readable message addressed to a chat tile. Same
// transport as peer_send_message, but the target must be a chat tile.
export function chatSendMessage(db, input, opts = {}) {
  const to = getTileRow(db, input.to_tile_id);
  if (!to) throw err.tileNotFound(input.to_tile_id);
  if (to.type !== 'chat') throw err.badRequest(`chat_send_message target must be a chat tile, got '${to.type}'`);
  return sendMessage(db, input, opts);
}

// chat_acknowledge: the recipient acknowledges receipt/completion of a message.
export function acknowledgeMessage(db, { message_id, tile_id }, { clock } = {}) {
  if (!message_id) throw err.badRequest('message_id is required');
  const row = db.prepare(`SELECT * FROM message WHERE id = ?`).get(message_id);
  if (!row) throw err.badRequest(`Unknown message: ${message_id}`);
  if (tile_id && row.to_tile_id !== tile_id) throw err.badRequest('only the recipient can acknowledge a message');
  const ts = nowIso(clock);
  db.prepare(
    `UPDATE message SET delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?), acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?`
  ).run(ts, ts, ts, message_id);
  return mapMessage(db.prepare(`SELECT * FROM message WHERE id = ?`).get(message_id));
}

// -------- retention (Phase 4) --------
// Purge messages older than `olderThanDays` (default 30, DATA_MODEL.md section 7).
// Returns the number removed.
export function purgeExpiredMessages(db, { olderThanDays = 30, clock } = {}) {
  const cutoff = new Date((clock ? clock() : Date.now()) - olderThanDays * 86_400_000).toISOString();
  const info = db.prepare(`DELETE FROM message WHERE created_at < ?`).run(cutoff);
  return Number(info.changes);
}

// -------- todos --------
export function addTodo(db, input, { clock } = {}) {
  const { creator_tile_id, assignee_tile_id, title } = input;
  if (!title) throw err.badRequest('title is required');
  const creator = creator_tile_id ? getTileRow(db, creator_tile_id) : null;
  const workspaceId = input.workspace_id ?? creator?.workspace_id;
  if (!workspaceId) throw err.badRequest('workspace_id or a known creator_tile_id is required');
  const id = newTodoId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO todo (id, workspace_id, creator_tile_id, assignee_tile_id, title, description, status, priority, due_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(
    id, workspaceId, creator_tile_id ?? null, assignee_tile_id ?? null, title,
    input.description ?? null, input.priority ?? 'normal', input.due_at ?? null, ts
  );
  audit(db, {
    workspace_id: workspaceId, actor_type: 'tile', actor_id: creator_tile_id, tile_id: assignee_tile_id,
    event_type: 'todo_assigned', entity_type: 'todo', entity_id: id,
    payload: { title, assignee: assignee_tile_id ?? null }, created_at: ts,
  });
  return mapTodo(db.prepare(`SELECT * FROM todo WHERE id = ?`).get(id));
}

export function completeTodo(db, { todo_id, completing_tile_id, result_summary = null }, { clock } = {}) {
  if (!todo_id) throw err.badRequest('todo_id is required');
  const row = db.prepare(`SELECT * FROM todo WHERE id = ?`).get(todo_id);
  if (!row) throw err.badRequest(`Unknown todo: ${todo_id}`);
  const ts = nowIso(clock);
  db.prepare(`UPDATE todo SET status='done', completed_at=?, result_summary=? WHERE id=?`).run(ts, result_summary, todo_id);
  audit(db, {
    workspace_id: row.workspace_id, actor_type: 'tile', actor_id: completing_tile_id, tile_id: completing_tile_id,
    event_type: 'todo_completed', entity_type: 'todo', entity_id: todo_id,
    payload: { result_summary }, created_at: ts,
  });
  return mapTodo(db.prepare(`SELECT * FROM todo WHERE id = ?`).get(todo_id));
}

export function listTodos(db, workspaceId) {
  return db.prepare(`SELECT * FROM todo WHERE workspace_id = ?`).all(workspaceId).map(mapTodo);
}

// -------- mappers --------
function mapMessage(r) {
  return {
    id: r.id, from_tile_id: r.from_tile_id, to_tile_id: r.to_tile_id, reply_to_id: r.reply_to_id,
    priority: r.priority, text: r.text, requires_ack: !!r.requires_ack,
    created_at: r.created_at, delivered_at: r.delivered_at, read_at: r.read_at, acknowledged_at: r.acknowledged_at,
  };
}

function mapTodo(r) {
  return {
    id: r.id, creator_tile_id: r.creator_tile_id, assignee_tile_id: r.assignee_tile_id,
    title: r.title, description: r.description, status: r.status, priority: r.priority,
    due_at: r.due_at, created_at: r.created_at, completed_at: r.completed_at, result_summary: r.result_summary,
  };
}
