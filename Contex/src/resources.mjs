// -------- MCP resources --------
// Read-only `context://` views over workspace + tile state (MCP_API.md section
// 2). These are the other half of MCP: `resources/list` advertises them,
// `resources/read` renders one. Round/Phase 2 ships the workspace + tile-state
// views; inbox/tasks/objective/skills/audit resources arrive with their phases.

import { activeClaimsForTile } from './domain/tiles.mjs';
import { availableToolsForType } from './domain/peers.mjs';
import { activeTileCount } from './domain/workspace.mjs';
import { err } from './errors.mjs';
import { listAuditFeed } from './store.mjs';

const JSON_MIME = 'application/json';
const MD_MIME = 'text/markdown';

// -------- resources/list --------
export function listResources(contex) {
  const out = [];
  for (const ws of contex.listWorkspaces()) {
    out.push({ uri: `context://workspace/${ws.id}`, name: `workspace: ${ws.name}`, description: 'Workspace metadata', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/graph`, name: `graph: ${ws.name}`, description: 'Tiles + canvas links', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/tasks`, name: `tasks: ${ws.name}`, description: 'Tasks + todos', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/timeline`, name: `timeline: ${ws.name}`, description: 'Agent status/message/task timeline', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/audit`, name: `audit: ${ws.name}`, description: 'Recent audit events (forward-scannable for Workspace Memory)', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/polly`, name: `polly: ${ws.name}`, description: 'Polly Arranger registry views', mimeType: JSON_MIME });
    out.push({ uri: `context://workspace/${ws.id}/polly/actions`, name: `polly actions: ${ws.name}`, description: 'Polly Arranger operator action requests', mimeType: JSON_MIME });
    for (const reg of pollyRegistryRows(contex, ws.id)) {
      out.push({ uri: `context://workspace/${ws.id}/polly/${reg.registry_hash}`, name: `polly registry: ${reg.registry_hash}`, description: 'Polly Arranger registry summary', mimeType: JSON_MIME });
      out.push({ uri: `context://workspace/${ws.id}/polly/${reg.registry_hash}/items`, name: `polly items: ${reg.registry_hash}`, description: 'Polly Arranger item tasks', mimeType: JSON_MIME });
      out.push({ uri: `context://workspace/${ws.id}/polly/${reg.registry_hash}/actions`, name: `polly actions: ${reg.registry_hash}`, description: 'Polly Arranger registry action requests', mimeType: JSON_MIME });
    }
    for (const tile of contex.listTiles(ws.id)) {
      out.push({ uri: `context://tile/${tile.tile_id}/state`, name: `state: ${tile.tile_id}`, description: 'Current tile status + claims', mimeType: JSON_MIME });
      out.push({ uri: `context://tile/${tile.tile_id}/objective`, name: `objective: ${tile.tile_id}`, description: 'Objective (objective.md)', mimeType: MD_MIME });
      out.push({ uri: `context://tile/${tile.tile_id}/skills`, name: `skills: ${tile.tile_id}`, description: 'Enabled/disabled skills (skills.json)', mimeType: JSON_MIME });
      out.push({ uri: `context://tile/${tile.tile_id}/peers`, name: `peers: ${tile.tile_id}`, description: 'Linked peers (peers.md)', mimeType: MD_MIME });
      out.push({ uri: `context://tile/${tile.tile_id}/inbox`, name: `inbox: ${tile.tile_id}`, description: 'Recent messages', mimeType: JSON_MIME });
      out.push({ uri: `context://tile/${tile.tile_id}/timeline`, name: `timeline: ${tile.tile_id}`, description: 'Status/message/task timeline for this tile/Agent', mimeType: JSON_MIME });
    }
  }
  return out;
}

// -------- resources/read --------
// Returns an MCP resource contents entry: { uri, mimeType, text }.
export function readResource(contex, uri) {
  let m;
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)$/))) {
    return jsonResource(uri, workspaceView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/graph$/))) {
    return jsonResource(uri, graphView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/tasks$/))) {
    return jsonResource(uri, tasksView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/timeline$/))) {
    return jsonResource(uri, timelineView(contex, { workspace_id: m[1] }));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/audit$/))) {
    return jsonResource(uri, auditView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly$/))) {
    return jsonResource(uri, pollyView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly\/actions$/))) {
    return jsonResource(uri, pollyActionsView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly\/([^/]+)$/))) {
    return jsonResource(uri, pollyRegistryView(contex, m[1], m[2]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly\/([^/]+)\/actions$/))) {
    return jsonResource(uri, pollyActionsView(contex, m[1], { registry_hash: m[2] }));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly\/([^/]+)\/items$/))) {
    return jsonResource(uri, pollyItemsView(contex, m[1], m[2]));
  }
  if ((m = uri.match(/^context:\/\/workspace\/([^/]+)\/polly\/([^/]+)\/item\/([^/]+)$/))) {
    return jsonResource(uri, pollyItemView(contex, m[1], m[2], decodeURIComponent(m[3])));
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/state$/))) {
    return jsonResource(uri, tileStateView(contex, m[1]));
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/objective$/))) {
    return { uri, mimeType: MD_MIME, text: objectiveMarkdown(contex, m[1]) };
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/skills$/))) {
    return jsonResource(uri, contex.listSkills(m[1]));
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/peers$/))) {
    return { uri, mimeType: MD_MIME, text: peersMarkdown(contex, m[1]) };
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/inbox$/))) {
    contex.getTile(m[1]); // throws TILE_NOT_FOUND for unknown tiles
    return jsonResource(uri, { tile_id: m[1], messages: contex.listInbox(m[1]) });
  }
  if ((m = uri.match(/^context:\/\/tile\/([^/]+)\/timeline$/))) {
    contex.getTile(m[1]); // throws TILE_NOT_FOUND for unknown tiles
    return jsonResource(uri, timelineView(contex, { tile_id: m[1] }));
  }
  throw err.badRequest(`Unknown or unsupported resource uri: ${uri}`);
}

function jsonResource(uri, obj) {
  return { uri, mimeType: JSON_MIME, text: JSON.stringify(obj, null, 2) };
}

// -------- views --------
function workspaceView(contex, id) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  return {
    id: ws.id,
    name: ws.name,
    repository_path: ws.repository_path,
    revision: ws.revision,
    active_tile_count: activeTileCount(contex.db, id),
    created_at: ws.created_at,
    archived: ws.archived_at != null,
  };
}

function graphView(contex, id) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  return {
    workspace_id: id,
    nodes: contex.listTiles(id),
    edges: contex.listLinks(id).map((l) => ({ source: l.source_tile_id, target: l.target_tile_id, kind: l.kind, directed: !!l.directed })),
  };
}

function tasksView(contex, id) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  return { workspace_id: id, tasks: contex.listTasks(id), todos: contex.listTodos(id) };
}

function auditView(contex, id) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  // Return last 100 events in forward order so a consumer can read and
  // checkpoint by the highest `sequence` value.
  const events = listAuditFeed(contex.db, id, { since_sequence: 0, limit: 100 });
  return { workspace_id: id, event_count: events.length, events };
}

function timelineView(contex, input) {
  const workspaceId = input.workspace_id || contex.getTile(input.tile_id).workspace_id;
  const ws = contex.getWorkspace(workspaceId);
  if (!ws) throw err.workspaceNotFound(workspaceId);
  const events = contex.listTimeline({ ...input, workspace_id: workspaceId, limit: 100 });
  return {
    workspace_id: workspaceId,
    tile_id: input.tile_id ?? null,
    event_count: events.length,
    events,
  };
}

function pollyView(contex, id) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  return { workspace_id: id, registries: pollyRegistryRows(contex, id) };
}

function pollyRegistryView(contex, id, hash) {
  const registries = pollyRegistryRows(contex, id).filter((r) => r.registry_hash === hash);
  if (registries.length === 0) throw err.badRequest(`Unknown Polly registry: ${hash}`);
  const items = pollyItemRows(contex, id, hash);
  return {
    ...registries[0],
    items_total: items.length,
    items_by_status: countBy(items, (item) => item.polly_status || item.status),
  };
}

function pollyItemsView(contex, id, hash) {
  contex.getWorkspace(id) || (() => { throw err.workspaceNotFound(id); })();
  return { workspace_id: id, registry_hash: hash, items: pollyItemRows(contex, id, hash) };
}

function pollyItemView(contex, id, hash, itemId) {
  const item = pollyItemRows(contex, id, hash).find((row) => row.item_id === itemId);
  if (!item) throw err.badRequest(`Unknown Polly item: ${itemId}`);
  return item;
}

function pollyActionsView(contex, id, filter = {}) {
  const ws = contex.getWorkspace(id);
  if (!ws) throw err.workspaceNotFound(id);
  return {
    workspace_id: id,
    ...contex.listPollyActionRequests({ workspace_id: id, ...filter }),
  };
}

function tileStateView(contex, tileId) {
  const tile = contex.getTile(tileId); // throws TILE_NOT_FOUND
  return {
    ...tile,
    claims: activeClaimsForTile(contex.db, tileId).map((c) => ({ path: c.path, mode: c.mode, section: c.section })),
  };
}

// Render the historical objective.md (DATA_MODEL.md section 6): objective title,
// available skills, communication channel, rules, generated timestamp.
function objectiveMarkdown(contex, tileId) {
  contex.getTile(tileId); // throws TILE_NOT_FOUND
  const obj = contex.getObjective(tileId);
  if (!obj) return `# Objective for ${tileId}\n\n_No objective set._`;
  const skills = contex.listSkills(tileId);
  const lines = [`# Objective for ${tileId} (v${obj.version})`, ''];
  if (obj.markdown) lines.push(obj.markdown, '');
  lines.push('## Skills');
  lines.push(`- enabled: ${skills.enabled.join(', ') || '(none)'}`);
  lines.push(`- disabled: ${skills.disabled.join(', ') || '(none)'}`, '');
  lines.push('## Channel', `tile:${tileId}`, '');
  if (obj.rules && obj.rules.length) {
    lines.push('## Rules');
    for (const r of obj.rules) lines.push(`- ${r}`);
    lines.push('');
  }
  lines.push(`_Generated ${obj.created_at}_`);
  return lines.join('\n');
}

// Render the historical peers.md (DATA_MODEL.md section 6): connected tile type
// and id, its available tools, and the regeneration notice.
function peersMarkdown(contex, tileId) {
  const view = contex.getState({ tile_id: tileId }); // throws TILE_NOT_FOUND
  const lines = [`# Peers for ${tileId}`, ''];
  if (view.peers.length === 0) {
    lines.push('_No linked peers._');
  } else {
    for (const p of view.peers) {
      lines.push(`- ${p.tile_id} (${p.type}) — ${p.status}`);
      const tools = p.available_tools && p.available_tools.length ? p.available_tools : availableToolsForType(p.type);
      if (tools.length) lines.push(`  tools: ${tools.join(', ')}`);
    }
  }
  lines.push('', '_Generated from canvas links; regenerated when links change._');
  return lines.join('\n');
}

function pollyRegistryRows(contex, workspaceId) {
  const rows = contex.db.prepare(
    `SELECT channel, COUNT(*) AS item_count
       FROM task
      WHERE workspace_id = ? AND channel LIKE 'polly:%'
      GROUP BY channel
      ORDER BY channel`
  ).all(workspaceId);
  return rows.map((row) => {
    const hash = String(row.channel).slice('polly:'.length);
    const daemon = contex.db.prepare('SELECT * FROM tile WHERE id = ?').get(`polly:${hash}:daemon`);
    return {
      workspace_id: workspaceId,
      registry_hash: hash,
      channel: row.channel,
      item_count: row.item_count,
      daemon_tile_id: `polly:${hash}:daemon`,
      daemon_status: daemon?.status ?? null,
      updated_at: daemon?.updated_at ?? null,
    };
  });
}

function pollyItemRows(contex, workspaceId, hash) {
  const channel = `polly:${hash}`;
  const tasks = contex.db.prepare(
    `SELECT * FROM task WHERE workspace_id = ? AND channel = ? ORDER BY created_at ASC`
  ).all(workspaceId, channel);
  return tasks.map((task) => {
    const itemId = String(task.owner_tile_id || '').replace(`polly:${hash}:item:`, '');
    const tile = contex.db.prepare('SELECT * FROM tile WHERE id = ?').get(task.owner_tile_id);
    const claims = activeClaimsForTile(contex.db, task.owner_tile_id)
      .map((claim) => ({ path: claim.path, mode: claim.mode, section: claim.section }));
    return {
      workspace_id: workspaceId,
      registry_hash: hash,
      item_id: itemId,
      task_id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      polly_status: tile?.progress ?? null,
      blocker: task.blocker,
      result_summary: task.result_summary,
      owner_tile_id: task.owner_tile_id,
      branch: tile?.branch ?? null,
      worktree: tile?.worktree ?? null,
      claims,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
    };
  });
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
