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
import { sendMessage, readMessages, unreadCount, addTodo, completeTodo, listTodos } from './domain/messaging.mjs';
import { listAudit } from './store.mjs';
import { err } from './errors.mjs';

const N = (s) => `notifications/context/${s}`;

export function createContex({ dbPath = ':memory:', clock = null, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
  const db = openDb(dbPath);
  const baseOpts = { clock, heartbeatTimeoutMs };
  const readOpts = () => ({ now: clock ? clock() : Date.now(), heartbeatTimeoutMs });

  const events = new EventEmitter();
  events.setMaxListeners(0); // one listener per connected SSE stream; don't warn
  const notify = (method, params) => events.emit('notification', { method, params });

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
      notify(N('tile_state_changed'), { tile_id: t.tile_id, status: t.status, version: t.version });
      const view = getPeerState(db, { tile_id: t.tile_id }, readOpts());
      if (view.conflicts.length) notify(N('file_conflict'), { tile_id: t.tile_id, conflicts: view.conflicts });
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
      notify(N('peer_link_changed'), { source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'created' });
      return link;
    },
    unlinkTiles(input) {
      const workspace_id = resolveWorkspaceId(input);
      const removed = unlinkTiles(db, { ...input, workspace_id }, baseOpts);
      if (removed) notify(N('peer_link_changed'), { source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'deleted' });
      return removed;
    },
    listLinks: (workspaceId) => listLinks(db, workspaceId),

    // messaging + todos
    sendMessage(input) {
      const m = sendMessage(db, input, baseOpts);
      notify(N('message_received'), { to_tile_id: m.to_tile_id, from_tile_id: m.from_tile_id, message_id: m.id });
      return m;
    },
    readMessages: (input) => readMessages(db, input, baseOpts),
    unreadCount: (tileId) => unreadCount(db, tileId),
    addTodo(input) {
      const workspace_id = input.workspace_id || (input.creator_tile_id ? undefined : resolveWorkspaceId(input));
      const td = addTodo(db, { ...input, workspace_id }, baseOpts);
      notify(N('todo_assigned'), { assignee_tile_id: td.assignee_tile_id, todo_id: td.id });
      return td;
    },
    completeTodo: (input) => completeTodo(db, input, baseOpts),
    listTodos: (workspaceId) => listTodos(db, workspaceId),

    // audit
    listAudit: (workspaceId, limit) => listAudit(db, workspaceId, limit),

    close() {
      events.removeAllListeners();
      db.close();
    },
  };
}

export { ErrorCodes, ContexError } from './errors.mjs';
