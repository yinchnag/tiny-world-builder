// -------- Contex core facade --------
// A thin object over the db + domain modules. This is the embedding API used by
// both the MCP tool layer (src/tools.mjs) and the tests. It is transport- and
// auth-agnostic: those concerns live in src/server.mjs + src/mcp-transport.mjs.
//
// Mutating operations emit MCP notifications on `events` ('notification' =>
// { method, params }); the transport's server->client SSE stream forwards them.

import { EventEmitter } from 'node:events';
import { openDb } from './db.mjs';
import { createWorkspace, getWorkspace, soleWorkspace, listWorkspaces, archiveWorkspace, setWorkspaceDiscovery } from './domain/workspace.mjs';
import { setTileState, getTile, listTiles, DEFAULT_HEARTBEAT_TIMEOUT_MS } from './domain/tiles.mjs';
import { getPeerState } from './domain/peers.mjs';
import { linkTiles, unlinkTiles, listLinks } from './domain/links.mjs';
import { releaseClaim, purgeExpiredClaims } from './domain/claims.mjs';
import { sendMessage, readMessages, unreadCount, addTodo, completeTodo, listTodos, chatSendMessage, acknowledgeMessage, listInbox, purgeExpiredMessages } from './domain/messaging.mjs';
import { createTask, updateTask, pauseTask, getTask, listTasks, importTaskState } from './domain/tasks.mjs';
import { setObjective, getObjective, objectiveVersions, acknowledgeObjective, reloadObjective, objectiveReloadRequired } from './domain/objectives.mjs';
import { setSkill, listSkillAssignments, skillsJson } from './domain/skills.mjs';
import { addAttachment, listAttachments } from './domain/attachments.mjs';
import { listAudit, audit, nowIso } from './store.mjs';
import { err } from './errors.mjs';

const N = (s) => `notifications/context/${s}`;

export function createContex({ dbPath = ':memory:', clock = null, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
  const db = openDb(dbPath);
  const baseOpts = { clock, heartbeatTimeoutMs };
  const readOpts = () => ({ now: clock ? clock() : Date.now(), heartbeatTimeoutMs });

  const events = new EventEmitter();
  events.setMaxListeners(0); // one listener per connected SSE stream; don't warn
  const emitNote = (method, params) => events.emit('notification', { method, params });

  function resolveWorkspaceId(input) {
    if (input && input.workspace_id) return input.workspace_id;
    const only = soleWorkspace(db);
    if (only) return only.id;
    throw err.badRequest('workspace_id is required (no single default workspace exists)');
  }

  return {
    db,
    events,
    options: { dbPath, heartbeatTimeoutMs },

    // workspace
    createWorkspace: (input) => createWorkspace(db, input, baseOpts),
    getWorkspace: (id) => getWorkspace(db, id),
    soleWorkspace: () => soleWorkspace(db),
    listWorkspaces: (opts) => listWorkspaces(db, opts),
    archiveWorkspace: (id) => archiveWorkspace(db, id, baseOpts),
    setWorkspaceDiscovery: (id, enabled) => setWorkspaceDiscovery(db, id, enabled, baseOpts),

    // tiles / presence
    setState(input) {
      const workspace_id = resolveWorkspaceId(input);
      const t = setTileState(db, { ...input, workspace_id }, baseOpts);
      emitNote(N('tile_state_changed'), { tile_id: t.tile_id, status: t.status, version: t.version });
      const view = getPeerState(db, { tile_id: t.tile_id }, readOpts());
      if (view.conflicts.length) emitNote(N('file_conflict'), { tile_id: t.tile_id, conflicts: view.conflicts });
      return t;
    },
    getState(input) {
      return getPeerState(db, input, readOpts());
    },
    getTile: (tile_id) => getTile(db, tile_id, readOpts()),
    listTiles: (workspaceId) => listTiles(db, workspaceId, readOpts()),

    // links (canvas edges; owner/CodeSurf in the full system)
    linkTiles(input) {
      const workspace_id = resolveWorkspaceId(input);
      const link = linkTiles(db, { ...input, workspace_id }, baseOpts);
      emitNote(N('peer_link_changed'), { source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'created' });
      return link;
    },
    unlinkTiles(input) {
      const workspace_id = resolveWorkspaceId(input);
      const removed = unlinkTiles(db, { ...input, workspace_id }, baseOpts);
      if (removed) emitNote(N('peer_link_changed'), { source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'deleted' });
      return removed;
    },
    listLinks: (workspaceId) => listLinks(db, workspaceId),

    // file claims (owner override + expiry; Phase 6)
    releaseClaim(input) {
      const released = releaseClaim(db, input, baseOpts);
      if (released) emitNote(N('file_conflict'), { tile_id: input.tile_id, released: input.path ?? 'all' });
      return released;
    },
    purgeExpiredClaims: () => purgeExpiredClaims(db, baseOpts),

    // messaging + todos
    sendMessage(input) {
      const m = sendMessage(db, input, baseOpts);
      emitNote(N('message_received'), { to_tile_id: m.to_tile_id, from_tile_id: m.from_tile_id, message_id: m.id });
      return m;
    },
    readMessages: (input) => readMessages(db, input, baseOpts),
    unreadCount: (tileId) => unreadCount(db, tileId),
    addTodo(input) {
      const workspace_id = input.workspace_id || (input.creator_tile_id ? undefined : resolveWorkspaceId(input));
      const td = addTodo(db, { ...input, workspace_id }, baseOpts);
      emitNote(N('todo_assigned'), { assignee_tile_id: td.assignee_tile_id, todo_id: td.id });
      return td;
    },
    completeTodo: (input) => completeTodo(db, input, baseOpts),
    listTodos: (workspaceId) => listTodos(db, workspaceId),

    // tasks (Phase 5)
    createTask(input) {
      const channelWs = input.channel ? db.prepare('SELECT workspace_id FROM tile WHERE id = ?').get(input.channel)?.workspace_id : null;
      const workspace_id = input.workspace_id || channelWs || resolveWorkspaceId(input);
      const t = createTask(db, { ...input, workspace_id }, baseOpts);
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    updateTask(input) {
      const t = updateTask(db, input, baseOpts);
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    pauseTask(input) {
      const t = pauseTask(db, input, baseOpts);
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    getTask: (id) => getTask(db, id),
    listTasks: (workspaceId, opts) => listTasks(db, workspaceId, opts),
    importTaskState(input) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      return importTaskState(db, { ...input, workspace_id }, baseOpts);
    },

    // objectives + skills + context (Phase 7)
    setObjective(input) {
      const tileRow = db.prepare('SELECT workspace_id FROM tile WHERE id = ?').get(input.tile_id);
      const workspace_id = input.workspace_id || tileRow?.workspace_id || null;
      const obj = setObjective(db, { ...input, workspace_id }, baseOpts);
      emitNote(N('objective_reload_required'), { tile_id: input.tile_id, version: obj.version });
      return obj;
    },
    getObjective: (tileId) => getObjective(db, tileId),
    objectiveVersions: (tileId) => objectiveVersions(db, tileId),
    objectiveReloadRequired: (tileId) => objectiveReloadRequired(db, tileId),
    acknowledgeObjective: (input) => acknowledgeObjective(db, input, baseOpts),
    reloadObjective: (input) => reloadObjective(db, input, baseOpts),
    setSkill: (input) => setSkill(db, input, baseOpts),
    listSkills: (tileId) => skillsJson(db, tileId),
    listSkillAssignments: (tileId) => listSkillAssignments(db, tileId),
    addAttachment: (input) => addAttachment(db, input, baseOpts),
    listAttachments: (tileId) => listAttachments(db, tileId),
    // get_context: everything an agent needs for a tile. Attachments are returned
    // as references (metadata + uri), not inline, so large ones fetch as resources.
    getContext(input) {
      const tile = getTile(db, input.tile_id, readOpts()); // throws TILE_NOT_FOUND
      return {
        tile_id: tile.tile_id,
        objective: getObjective(db, tile.tile_id),
        skills: skillsJson(db, tile.tile_id),
        peers: getPeerState(db, { tile_id: tile.tile_id }, readOpts()).peers,
        tasks: listTasks(db, tile.workspace_id, { channel: tile.tile_id }),
        attachments: listAttachments(db, tile.tile_id),
        reload_required: objectiveReloadRequired(db, tile.tile_id),
      };
    },

    // chat adapters + notifications (Phase 4)
    chatSendMessage(input) {
      const m = chatSendMessage(db, input, baseOpts);
      emitNote(N('message_received'), { to_tile_id: m.to_tile_id, from_tile_id: m.from_tile_id, message_id: m.id });
      return m;
    },
    acknowledgeMessage: (input) => acknowledgeMessage(db, input, baseOpts),
    listInbox: (tileId, opts) => listInbox(db, tileId, opts),
    purgeExpiredMessages: (opts = {}) => purgeExpiredMessages(db, { clock, ...opts }),
    // notify: workspace notification; level 'human_attention' raises a flag for the human
    notify(input = {}) {
      const level = input.level || 'info';
      const workspace_id = input.workspace_id || soleWorkspace(db)?.id || null;
      const payload = { level, text: input.text ?? null, tile_id: input.tile_id ?? null };
      audit(db, {
        workspace_id, actor_type: 'tile', actor_id: input.tile_id ?? null, tile_id: input.tile_id ?? null,
        event_type: 'notification', entity_type: 'notification', payload, created_at: nowIso(clock),
      });
      emitNote(level === 'human_attention' ? N('human_attention') : N('notice'), payload);
      return { ok: true, level };
    },

    // audit
    listAudit: (workspaceId, limit) => listAudit(db, workspaceId, limit),

    close() {
      events.removeAllListeners();
      db.close();
    },
  };
}

export { ErrorCodes, ContexError } from './errors.mjs';
