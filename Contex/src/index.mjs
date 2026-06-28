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
import { setTileState, getTile, getTileRow, listTiles, activeClaims, TILE_TYPES, DEFAULT_HEARTBEAT_TIMEOUT_MS } from './domain/tiles.mjs';
import { getPeerState } from './domain/peers.mjs';
import { linkTiles, unlinkTiles, listLinks, canActOn } from './domain/links.mjs';
import { releaseClaim, purgeExpiredClaims } from './domain/claims.mjs';
import { enqueueCommand, getCommand, listCommands, nextCommands, completeCommand, expireStaleCommands } from './domain/commands.mjs';
import { sendMessage, readMessages, unreadCount, addTodo, completeTodo, listTodos, chatSendMessage, acknowledgeMessage, listInbox, purgeExpiredMessages } from './domain/messaging.mjs';
import { createTask, updateTask, pauseTask, getTask, listTasks, importTaskState } from './domain/tasks.mjs';
import { setObjective, getObjective, objectiveVersions, acknowledgeObjective, reloadObjective, objectiveReloadRequired } from './domain/objectives.mjs';
import { setSkill, listSkillAssignments, skillsJson } from './domain/skills.mjs';
import { addAttachment, listAttachments } from './domain/attachments.mjs';
import {
  agentRegister as registerAgent,
  agentUpdateState as updateAgentState,
  agentList as listAgents,
  agentSendMessage as sendAgentMessage,
  agentReadMessages as readAgentMessages,
  agentClaimTask as claimAgentTask,
  agentCompleteTask as completeAgentTask,
  agentRequestHandoff as requestAgentHandoff,
  agentReport as reportAgent,
  agentBroadcast as broadcastAgent,
} from './domain/agents.mjs';
import { listAudit, listAuditFeed, listTimeline, audit, nowIso, parseJson } from './store.mjs';
import { exportWorkspace, importWorkspace, redactSecrets } from './domain/export.mjs';
import { importTileDir as _importTileDir } from './domain/import-legacy.mjs';
import { syncPollySnapshot, requestPollyAction, listPollyActionRequests, recordPollyActionResult } from './domain/polly.mjs';
import { err } from './errors.mjs';

const N = (s) => `notifications/context/${s}`;

export function createContex({ dbPath = ':memory:', clock = null, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS } = {}) {
  const db = openDb(dbPath);
  const baseOpts = { clock, heartbeatTimeoutMs };
  const readOpts = () => ({ now: clock ? clock() : Date.now(), heartbeatTimeoutMs });

  // Per-call correlation context. JS is single-threaded and all domain functions
  // are synchronous, so this is safe: no other call can interleave between
  // _setCallCtx and _clearCallCtx within one synchronous callTool invocation.
  let _correlationId = null;
  const callOpts = () => ({ ...baseOpts, correlation_id: _correlationId });

  const events = new EventEmitter();
  events.setMaxListeners(0); // one listener per connected SSE stream; don't warn
  const emitNote = (method, params) => events.emit('notification', { method, params });

  // Token store slot — wired by startServer after construction.
  let _tokenStore = null;

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

    // Called by callTool in tools.mjs to thread a correlation_id through the
    // synchronous domain call without changing every method signature.
    _setCallCtx(correlationId) { _correlationId = correlationId; },
    _clearCallCtx() { _correlationId = null; },

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
      const t = setTileState(db, { ...input, workspace_id }, callOpts());
      emitNote(N('tile_state_changed'), { workspace_id, tile_id: t.tile_id, status: t.status, version: t.version });
      const view = getPeerState(db, { tile_id: t.tile_id }, readOpts());
      if (view.conflicts.length) emitNote(N('file_conflict'), { workspace_id, tile_id: t.tile_id, conflicts: view.conflicts });
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
      const link = linkTiles(db, { ...input, workspace_id }, callOpts());
      emitNote(N('peer_link_changed'), { workspace_id, source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'created' });
      return link;
    },
    unlinkTiles(input) {
      const workspace_id = resolveWorkspaceId(input);
      const removed = unlinkTiles(db, { ...input, workspace_id }, callOpts());
      if (removed) emitNote(N('peer_link_changed'), { workspace_id, source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id, action: 'deleted' });
      return removed;
    },
    listLinks: (workspaceId) => listLinks(db, workspaceId),

    // file claims (owner override + expiry; Phase 6)
    releaseClaim(input) {
      const released = releaseClaim(db, input, callOpts());
      if (released) emitNote(N('file_conflict'), { tile_id: input.tile_id, released: input.path ?? 'all' });
      return released;
    },
    purgeExpiredClaims: () => purgeExpiredClaims(db, baseOpts),

    // messaging + todos
    sendMessage(input) {
      const m = sendMessage(db, input, callOpts());
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
      const t = createTask(db, { ...input, workspace_id }, callOpts());
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    updateTask(input) {
      const t = updateTask(db, input, callOpts());
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    pauseTask(input) {
      const t = pauseTask(db, input, callOpts());
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    getTask: (id) => getTask(db, id),
    listTasks: (workspaceId, opts) => listTasks(db, workspaceId, opts),
    listFileClaims: (workspaceId) => activeClaims(db, workspaceId),
    importTaskState(input) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      return importTaskState(db, { ...input, workspace_id }, baseOpts);
    },

    // objectives + skills + context (Phase 7)
    setObjective(input) {
      const tileRow = db.prepare('SELECT workspace_id FROM tile WHERE id = ?').get(input.tile_id);
      const workspace_id = input.workspace_id || tileRow?.workspace_id || null;
      const obj = setObjective(db, { ...input, workspace_id }, callOpts());
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

    // agents (Agent Platform Upgrade Phase 2)
    agentRegister(input) {
      const workspace_id = resolveWorkspaceId(input);
      const agent = registerAgent(db, { ...input, workspace_id }, callOpts());
      emitNote(N('agent_state_changed'), { workspace_id, agent_id: agent.agent_id, tile_id: agent.tile_id, status: agent.status, role: agent.role, runtime: agent.runtime, version: agent.version });
      return agent;
    },
    agentUpdateState(input) {
      const agent = updateAgentState(db, input, callOpts());
      emitNote(N('agent_state_changed'), { workspace_id: agent.workspace_id, agent_id: agent.agent_id, tile_id: agent.tile_id, status: agent.status, role: agent.role, runtime: agent.runtime, version: agent.version });
      return agent;
    },
    agentList(input = {}) {
      const workspace_id = resolveWorkspaceId(input);
      return listAgents(db, { ...input, workspace_id }, readOpts());
    },
    agentSendMessage(input) {
      const m = sendAgentMessage(db, input, callOpts());
      emitNote(N('message_received'), { to_tile_id: m.to_tile_id, from_tile_id: m.from_tile_id, message_id: m.id });
      return m;
    },
    agentReadMessages: (input) => readAgentMessages(db, input, baseOpts),
    agentClaimTask(input) {
      const t = claimAgentTask(db, input, callOpts());
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    agentCompleteTask(input) {
      const t = completeAgentTask(db, input, callOpts());
      emitNote(N('task_changed'), { task_id: t.id, status: t.status, version: t.version });
      return t;
    },
    agentRequestHandoff(input) {
      const out = requestAgentHandoff(db, input, callOpts());
      if (out.task) emitNote(N('task_changed'), { task_id: out.task.id, status: out.task.status, version: out.task.version });
      emitNote(N('message_received'), { to_tile_id: out.message.to_tile_id, from_tile_id: out.message.from_tile_id, message_id: out.message.id });
      return out;
    },
    agentReport(input) {
      const out = reportAgent(db, input, callOpts());
      if (out.task) emitNote(N('task_changed'), { task_id: out.task.id, status: out.task.status, version: out.task.version });
      emitNote(N('message_received'), { to_tile_id: out.message.to_tile_id, from_tile_id: out.message.from_tile_id, message_id: out.message.id });
      return out;
    },
    agentBroadcast(input) {
      const workspace_id = resolveWorkspaceId(input);
      const out = broadcastAgent(db, { ...input, workspace_id }, callOpts());
      for (const r of out.recipients) {
        if (r.delivered) {
          emitNote(N('message_received'), { to_tile_id: r.message.to_tile_id, from_tile_id: r.message.from_tile_id, message_id: r.message.id });
        }
      }
      return out;
    },
    agentRequestHumanInput(input) {
      const agent_id = input.agent_id || input.tile_id;
      if (!agent_id) throw err.badRequest('agent_id is required');
      const tile = getTile(db, agent_id, readOpts());
      const workspace_id = input.workspace_id || tile.workspace_id || resolveWorkspaceId(input);
      const text = input.question || input.text || input.reason || 'Agent needs human input.';
      const status = input.status || (input.blocking === false ? 'waiting' : 'blocked');
      const agentUpdate = {
        workspace_id,
        agent_id,
        status,
        summary: input.summary || 'Waiting for human input.',
        blocker: text,
      };
      if (input.task !== undefined) agentUpdate.task = input.task;
      const agent = updateAgentState(db, agentUpdate, callOpts());
      emitNote(N('agent_state_changed'), { workspace_id, agent_id: agent.agent_id, tile_id: agent.tile_id, status: agent.status, role: agent.role, runtime: agent.runtime, version: agent.version });

      let task = null;
      if (input.task_id) {
        task = updateTask(db, {
          task_id: input.task_id,
          status: input.task_status,
          blocker: text,
          actor_tile_id: agent_id,
        }, callOpts());
        emitNote(N('task_changed'), { workspace_id, task_id: task.id, status: task.status, version: task.version });
      }

      const payload = {
        level: 'human_attention',
        text,
        tile_id: agent_id,
        task_id: input.task_id ?? null,
        reason: input.reason ?? null,
        severity: input.severity || 'decision',
      };
      audit(db, {
        workspace_id, actor_type: 'tile', actor_id: agent_id, tile_id: agent_id,
        event_type: 'notification', entity_type: 'notification',
        correlation_id: _correlationId ?? null,
        payload, created_at: nowIso(clock),
      });
      emitNote(N('human_attention'), payload);
      return { ok: true, agent, task, attention: payload };
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

    // Polly Arranger observe-only integration
    syncPollySnapshot(input = {}) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      const out = syncPollySnapshot(db, { ...input, workspace_id }, callOpts());
      for (const task_id of out.changed_tasks) {
        const task = getTask(db, task_id);
        emitNote(N('task_changed'), { workspace_id, task_id, status: task?.status, version: task?.version, source: 'polly' });
      }
      for (const note of out.human_attention) {
        audit(db, {
          workspace_id, actor_type: 'integration', actor_id: out.daemon_tile_id,
          tile_id: note.tile_id, event_type: 'notification', entity_type: 'notification',
          payload: { level: 'human_attention', ...note }, created_at: nowIso(clock),
        });
        emitNote(N('human_attention'), note);
      }
      return out;
    },
    requestPollyAction(input = {}) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      const out = requestPollyAction(db, { ...input, workspace_id }, callOpts());
      emitNote(N('polly_action_requested'), {
        workspace_id,
        request_id: out.request_id,
        registry_hash: out.registry_hash,
        item_id: out.item_id,
        action: out.action,
        tile_id: out.requested_by_tile_id,
      });
      return out;
    },
    listPollyActionRequests(input = {}) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      return listPollyActionRequests(db, { ...input, workspace_id });
    },
    recordPollyActionResult(input = {}) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      const out = recordPollyActionResult(db, { ...input, workspace_id }, callOpts());
      emitNote(N('polly_action_result'), {
        workspace_id,
        request_id: out.request_id,
        registry_hash: out.registry_hash,
        item_id: out.item_id,
        action: out.action,
        status: out.status,
        message: out.message,
      });
      return out;
    },

    // canvas command bus (Phase 8)
    canvasCreateTile(input) {
      if (!input.tile_type || !TILE_TYPES.has(input.tile_type)) throw err.badRequest(`invalid tile_type: ${input.tile_type}`);
      const workspace_id = resolveWorkspaceId(input);
      const cmd = enqueueCommand(db, {
        workspace_id, requester_tile_id: input.requester_tile_id, kind: 'create_tile',
        payload: { tile_type: input.tile_type, title: input.title ?? null, objective: input.objective ?? null, skills: input.skills ?? null, position_hint: input.position_hint ?? null, link_to_requester: input.link_to_requester !== false, command: input.command ?? null, content: input.content ?? null },
      }, callOpts());
      emitNote(N('canvas_command'), { workspace_id, command_id: cmd.id, kind: cmd.kind });
      return cmd;
    },
    terminalSendInput(input) {
      const target = getTileRow(db, input.target_tile_id);
      if (!target) throw err.tileNotFound(input.target_tile_id);
      // caller must be linked to (or directed-allowed on) the target
      if (!canActOn(db, target.workspace_id, input.requester_tile_id, input.target_tile_id)) {
        throw err.peerNotLinked(input.requester_tile_id, input.target_tile_id);
      }
      // target must advertise terminal-input capability
      const caps = parseJson(target.capabilities_json, []) || [];
      if (!Array.isArray(caps) || !caps.includes('terminal_input')) {
        throw err.badRequest('target tile does not advertise terminal input');
      }
      // control sequences are destructive -> require explicit confirmation
      if (input.control != null && input.confirm !== true) {
        throw err.scopeDenied('control input requires confirm:true (owner confirmation)');
      }
      const cmd = enqueueCommand(db, {
        workspace_id: target.workspace_id, requester_tile_id: input.requester_tile_id, target_tile_id: input.target_tile_id,
        kind: 'terminal_input', payload: { text: input.text ?? null, control: input.control ?? null },
      }, baseOpts);
      emitNote(N('canvas_command'), { command_id: cmd.id, kind: cmd.kind });
      return cmd;
    },
    canvasFocus(input) {
      const workspace_id = resolveWorkspaceId(input);
      const cmd = enqueueCommand(db, { workspace_id, requester_tile_id: input.requester_tile_id, target_tile_id: input.tile_id, kind: 'focus', payload: { tile_id: input.tile_id } }, baseOpts);
      emitNote(N('canvas_command'), { command_id: cmd.id, kind: cmd.kind });
      return cmd;
    },
    canvasHighlight(input) {
      const workspace_id = resolveWorkspaceId(input);
      const cmd = enqueueCommand(db, { workspace_id, requester_tile_id: input.requester_tile_id, target_tile_id: input.tile_id, kind: 'highlight', payload: { tile_id: input.tile_id, reason: input.reason ?? null } }, baseOpts);
      emitNote(N('canvas_command'), { command_id: cmd.id, kind: cmd.kind });
      return cmd;
    },
    canvasConnect(input) {
      const workspace_id = resolveWorkspaceId(input);
      const cmd = enqueueCommand(db, { workspace_id, requester_tile_id: input.requester_tile_id, kind: 'connect', payload: { source_tile_id: input.source_tile_id, target_tile_id: input.target_tile_id } }, baseOpts);
      emitNote(N('canvas_command'), { command_id: cmd.id, kind: cmd.kind });
      return cmd;
    },
    // consumer-facing (CodeSurf / owner)
    nextCommands: (workspaceId, opts) => nextCommands(db, workspaceId ?? resolveWorkspaceId({}), { ...baseOpts, ...opts }),
    completeCommand(input) {
      const cmd = completeCommand(db, input, callOpts());
      emitNote(N('canvas_command_result'), { command_id: cmd.id, status: cmd.status, result: cmd.result, requester_tile_id: cmd.requester_tile_id });
      return cmd;
    },
    getCommand: (id) => getCommand(db, id),
    listCommands: (workspaceId) => listCommands(db, workspaceId),
    expireStaleCommands: (opts) => expireStaleCommands(db, { ...baseOpts, ...opts }),

    // audit + export (Phase 9)
    listAudit: (workspaceId, limit) => listAudit(db, workspaceId, limit),
    listAuditFeed: (workspaceId, opts) => listAuditFeed(db, workspaceId, opts),
    listTimeline(input = {}) {
      const tileRow = input.tile_id ? db.prepare('SELECT workspace_id FROM tile WHERE id = ?').get(input.tile_id) : null;
      const workspace_id = input.workspace_id || tileRow?.workspace_id || resolveWorkspaceId(input);
      return listTimeline(db, workspace_id, input);
    },
    exportWorkspace(workspaceIdOrNull, opts = {}) {
      const ws_id = workspaceIdOrNull ?? soleWorkspace(db)?.id;
      if (!ws_id) throw err.badRequest('workspace_id is required (no sole default workspace)');
      return exportWorkspace(db, ws_id, opts);
    },
    importWorkspace: (bundle) => importWorkspace(db, bundle),
    redactSecrets,

    // legacy tile directory import (Phase 12)
    importTileDir(input) {
      const workspace_id = input.workspace_id || resolveWorkspaceId(input);
      return _importTileDir(db, { tileId: input.tile_id, dir: input.dir, workspaceId: workspace_id, clock });
    },

    // scoped token store — wired by startServer; allows MCP tools to issue/revoke tokens
    setTokenStore(ts) { _tokenStore = ts; },
    issueClientToken(input) { return _tokenStore?.issue(input) ?? { error: 'No token store attached' }; },
    revokeClientToken(token) { return { revoked: _tokenStore?.revoke(token) ?? false }; },
    listClientTokens() { return _tokenStore?.list() ?? []; },

    close() {
      events.removeAllListeners();
      db.close();
    },
  };
}

export { ErrorCodes, ContexError } from './errors.mjs';
