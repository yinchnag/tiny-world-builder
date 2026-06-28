// CodeSurf loopback HTTP shell.
//
// Zero-dependency Node http server (node:http only) that serves the single-page
// DOM/SVG canvas from `public/` and a small JSON API over the M1 WorkspaceStore.
// Binds 127.0.0.1 only and rejects non-loopback Host headers (cheap DNS-rebinding
// guard) — the renderer is a local browser, so this is the trust boundary.
//
// API:
//   GET  /                          -> index.html (canvas shell)
//   GET  /canvas.js | /style.css    -> static assets
//   GET  /api/workspaces            -> { workspaces }
//   POST /api/workspaces            { name, repositoryPath } -> meta
//   GET  /api/workspaces/:id        -> { meta, layout, recovered }  (opens + locks)
//   PUT  /api/workspaces/:id/layout { layout } -> { ok, layout }    (autosave)
//   POST /api/workspaces/:id/close  -> { ok }                       (releases lock)

import { createServer as httpCreateServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, normalize, resolve, relative, isAbsolute } from 'node:path';
import { CodeSurfError } from './errors.mjs';
import { gitStatus, gitWorktrees, createGitWorktree } from './git.mjs';
import { buildMemoryProposal, applyMemoryProposal, addMemoryPin, addMemoryMarker } from './memory.mjs';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const CODEX_RUNTIME_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-runtime-codex.mjs');

// xterm.js assets served from node_modules (optional — falls back to a <pre> if
// not installed). Fixed allowlist, so no path-traversal surface.
const VENDOR = {
  '/vendor/xterm.mjs': { file: '@xterm/xterm/lib/xterm.mjs', type: 'text/javascript; charset=utf-8' },
  '/vendor/xterm.css': { file: '@xterm/xterm/css/xterm.css', type: 'text/css; charset=utf-8' },
  '/vendor/addon-fit.mjs': { file: '@xterm/addon-fit/lib/addon-fit.mjs', type: 'text/javascript; charset=utf-8' },
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function contentTypeFor(file) {
  const dot = file.lastIndexOf('.');
  return CONTENT_TYPES[dot >= 0 ? file.slice(dot).toLowerCase() : ''] || 'application/octet-stream';
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
                          'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, err) {
  if (err instanceof CodeSurfError) {
    const status = err.code === 'CODESURF_NOT_FOUND' ? 404
      : err.code === 'CODESURF_WORKSPACE_LOCKED' ? 409
      : err.code === 'CODESURF_REPO_INVALID' || err.code === 'CODESURF_BAD_REQUEST' ? 400 : 500;
    return sendJson(res, status, { error: err.toJSON() });
  }
  return sendJson(res, 500, { error: { code: 'CODESURF_INTERNAL', message: String(err && err.message || err) } });
}

async function contexViewCall(contex, tool, args) {
  try {
    return { ok: true, tool, value: await contex.call(tool, args) };
  } catch (err) {
    return { ok: false, tool, value: [], message: String(err && err.message || err) };
  }
}

async function contexViewCallFallback(contex, primary, fallback, args) {
  const first = await contexViewCall(contex, primary, args);
  const firstRows = normalizeList(first.value, primary === 'list_peers' ? 'peers' : primary);
  if ((first.ok && firstRows.length > 0) || !fallback) return first;
  const second = await contexViewCall(contex, fallback, args);
  if (!second.ok) return first;
  return { ...second, tool: `${primary}->${fallback}`, fallbackFrom: primary };
}

function normalizeList(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

function buildPollyView(tasks = [], claims = []) {
  const pollyTasks = tasks.filter((task) => String(task.channel || '').startsWith('polly:'));
  const items = pollyTasks.map((task) => {
    const channel = String(task.channel || '');
    const registryHash = channel.slice('polly:'.length);
    const owner = task.owner_tile_id || task.tile_id || '';
    const itemId = owner.startsWith(`polly:${registryHash}:item:`)
      ? owner.slice(`polly:${registryHash}:item:`.length)
      : owner;
    const summary = task.result_summary || '';
    const pr = summary.match(/\bPR #(\d+)/)?.[1] || null;
    const pollyStatus = summary.match(/^Polly\s+([^·]+)/)?.[1]?.trim() || task.status || 'unknown';
    return {
      registry_hash: registryHash,
      item_id: itemId,
      task_id: task.id || task.task_id || '',
      title: task.title || itemId || 'Polly item',
      status: task.status || 'open',
      polly_status: pollyStatus,
      owner_tile_id: owner,
      branch: summary.split('·').map((part) => part.trim()).find((part) => part.startsWith('polly/')) || null,
      pr,
      blocker: task.blocker || null,
      claims: claims.filter((claim) => (claim.tile_id || claim.tileId || claim.owner_tile_id) === owner),
      updated_at: task.updated_at || null,
      completed_at: task.completed_at || null,
    };
  });
  const registries = new Map();
  for (const item of items) {
    const row = registries.get(item.registry_hash) || {
      registry_hash: item.registry_hash,
      item_count: 0,
      active: 0,
      blocked: 0,
      ready: 0,
      done: 0,
    };
    row.item_count += 1;
    if (['blocked', 'paused'].includes(String(item.status).toLowerCase())) row.blocked += 1;
    if (String(item.polly_status).toUpperCase() === 'READY_FOR_HUMAN_MERGE') row.ready += 1;
    if (['done', 'completed', 'cancelled'].includes(String(item.status).toLowerCase())) row.done += 1;
    else row.active += 1;
    registries.set(item.registry_hash, row);
  }
  return { registries: [...registries.values()], items };
}

function resolveRepoFile(repositoryPath, requestedPath) {
  const relPath = String(requestedPath || '').trim();
  if (!relPath || relPath.includes('\0') || isAbsolute(relPath)) {
    throw new CodeSurfError('CODESURF_BAD_REQUEST', 'repository-relative path required');
  }
  const root = resolve(repositoryPath);
  const file = resolve(root, relPath);
  const outside = relative(root, file).startsWith('..');
  if (outside || file === root) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'path must stay inside the repository');
  return file;
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new CodeSurfError('CODESURF_BAD_REQUEST', 'request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new CodeSurfError('CODESURF_BAD_REQUEST', 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  if (urlPath === '/favicon.ico') return sendText(res, 204, '', 'image/x-icon');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const path = normalize(join(PUBLIC_DIR, rel));
  // traversal guard — resolved path must stay under public/
  if (path !== PUBLIC_DIR && !path.startsWith(PUBLIC_DIR + (process.platform === 'win32' ? '\\' : '/'))) {
    return sendJson(res, 403, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad path' } });
  }
  try {
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': contentTypeFor(path), 'content-length': buf.length, 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    sendJson(res, 404, { error: { code: 'CODESURF_NOT_FOUND', message: `asset missing: ${rel}` } });
  }
}

/** Build the request handler bound to a WorkspaceStore and an optional
 *  ContexConnection (Contex integration is opt-in — CodeSurf runs canvas-only
 *  without it). */
export function createHandler(store, contex = null, terminals = null) {
  return async function handler(req, res) {
    try {
      if (!isLoopbackHost(req.headers.host)) {
        return sendJson(res, 403, { error: { code: 'CODESURF_FORBIDDEN', message: 'non-loopback host rejected' } });
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method;

      // ---- Contex integration (opt-in) ----
      if (path === '/api/contex/status' && method === 'GET') {
        return sendJson(res, 200, contex
          ? { status: contex.status, url: contex.url, workspaceId: contex.workspaceId } // token NEVER exposed
          : { status: 'disconnected' });
      }
      if (path === '/api/agent-runtimes/codex' && method === 'GET') {
        return sendJson(res, 200, {
          runtime: 'codex',
          command: process.execPath,
          args: [CODEX_RUNTIME_SCRIPT],
          script: CODEX_RUNTIME_SCRIPT,
        });
      }
      if (path === '/api/contex/links' && (method === 'POST' || method === 'DELETE')) {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        if (!body.source || !body.target) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'source and target required');
        const out = method === 'POST'
          ? await contex.linkTiles(body.source, body.target, { directed: !!body.directed, kind: body.kind || '' })
          : await contex.unlinkTiles(body.source, body.target);
        return sendJson(res, 200, { ok: true, result: out });
      }
      if (path === '/api/contex/events' && method === 'GET') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        return streamContexEvents(req, res, contex);
      }
      const cmdDone = path.match(/^\/api\/contex\/commands\/([^/]+)\/complete$/);
      if (cmdDone && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        const out = await contex.completeCommand(decodeURIComponent(cmdDone[1]), body.result, body.error);
        return sendJson(res, 200, { ok: true, result: out });
      }

      // ---- Contex status / tasks / file claims (Phase 8) ----
      if (path === '/api/contex/status-view' && method === 'GET') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const [peers, tasks, claims] = await Promise.all([
          contexViewCallFallback(contex, 'list_peers', 'agent_list', { workspace_id: contex.workspaceId }),
          contexViewCall(contex, 'list_tasks', { workspace_id: contex.workspaceId }),
          contexViewCall(contex, 'list_file_claims', { workspace_id: contex.workspaceId }),
        ]);
        const peerRows = normalizeList(peers.value, peers.tool.includes('agent_list') ? 'agents' : 'peers');
        const taskRows = normalizeList(tasks.value, 'tasks');
        const claimRows = normalizeList(claims.value, 'claims');
        return sendJson(res, 200, {
          peers: peerRows,
          tasks: taskRows,
          claims: claimRows,
          polly: buildPollyView(taskRows, claimRows),
          partial: [peers, tasks, claims].filter((r) => !r.ok).map((r) => ({ tool: r.tool, message: r.message })),
        });
      }
      if (path === '/api/contex/human-attention' && method === 'GET') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const [blocked, waiting] = await Promise.all([
          contexViewCall(contex, 'agent_list', { workspace_id: contex.workspaceId, status: 'blocked' }),
          contexViewCall(contex, 'agent_list', { workspace_id: contex.workspaceId, status: 'waiting' }),
        ]);
        const rows = [...normalizeList(blocked.value, 'agents'), ...normalizeList(waiting.value, 'agents')];
        const seen = new Set();
        const attention = rows.filter((agent) => {
          const id = agent.agent_id || agent.tile_id || agent.id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        }).map((agent) => ({
          agent_id: agent.agent_id || agent.tile_id || agent.id,
          tile_id: agent.tile_id || agent.agent_id || agent.id,
          status: agent.status || 'blocked',
          role: agent.role || '',
          runtime: agent.runtime || '',
          text: agent.blocker || agent.summary || agent.task || 'Agent needs human input.',
          task: agent.task || '',
          blocker: agent.blocker || '',
          updated_at: agent.updated_at || null,
        }));
        return sendJson(res, 200, {
          attention,
          partial: [blocked, waiting].filter((r) => !r.ok).map((r) => ({ tool: r.tool, message: r.message })),
        });
      }
      const attentionAction = path.match(/^\/api\/contex\/human-attention\/([^/]+)\/(reply|reject|handled)$/);
      if (attentionAction && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const tileId = decodeURIComponent(attentionAction[1]);
        const action = attentionAction[2];
        const body = (await readBody(req)) || {};
        const text = String(body.text || '').trim();
        const result = { action, message: null, state: null };
        if (action === 'reply') {
          if (!text) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'reply text required');
          try {
            result.message = await contex.call('agent_send_message', {
              from_agent_id: body.from_agent_id || body.fromAgentId || 'human',
              to_agent_id: tileId,
              text,
              priority: body.priority || 'normal',
              requires_ack: false,
            });
          } catch (err) {
            result.message = { ok: false, error: String(err && err.message || err) };
          }
          result.state = await contex.call('agent_update_state', {
            workspace_id: contex.workspaceId,
            agent_id: tileId,
            status: body.status || 'working',
            blocker: '',
            summary: body.summary || 'Human replied from CodeSurf.',
          });
        } else if (action === 'reject') {
          result.state = await contex.call('agent_update_state', {
            workspace_id: contex.workspaceId,
            agent_id: tileId,
            status: 'blocked',
            blocker: text || body.reason || 'Human rejected the request.',
            summary: body.summary || 'Human rejected the request.',
          });
        } else {
          result.state = await contex.call('agent_update_state', {
            workspace_id: contex.workspaceId,
            agent_id: tileId,
            status: body.status || 'idle',
            blocker: '',
            summary: body.summary || 'Human marked the request handled.',
          });
        }
        return sendJson(res, 200, { ok: true, result });
      }
      const agentAction = path.match(/^\/api\/contex\/agent-actions\/([^/]+)\/(claim|complete|handoff|report|broadcast)$/);
      if (agentAction && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const tileId = decodeURIComponent(agentAction[1]);
        const action = agentAction[2];
        const body = (await readBody(req)) || {};
        let tool = '';
        let args = {};
        if (action === 'claim') {
          if (!body.task_id && !body.taskId) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'task_id required');
          tool = 'agent_claim_task';
          args = {
            agent_id: tileId,
            task_id: body.task_id || body.taskId,
            status: body.status || 'in_progress',
            ...(body.expected_version || body.expectedVersion ? { expected_version: Number(body.expected_version || body.expectedVersion) } : {}),
          };
        } else if (action === 'complete') {
          if (!body.task_id && !body.taskId) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'task_id required');
          tool = 'agent_complete_task';
          args = {
            agent_id: tileId,
            task_id: body.task_id || body.taskId,
            result_summary: body.result_summary || body.resultSummary || body.text || '',
          };
        } else if (action === 'handoff') {
          if (!body.to_agent_id && !body.toAgentId) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'to_agent_id required');
          tool = 'agent_request_handoff';
          args = {
            from_agent_id: tileId,
            to_agent_id: body.to_agent_id || body.toAgentId,
            text: body.text || 'Please take this handoff.',
            priority: body.priority || 'normal',
            requires_ack: body.requires_ack !== false,
            ...(body.task_id || body.taskId ? { task_id: body.task_id || body.taskId } : {}),
          };
        } else if (action === 'report') {
          if (!body.to_agent_id && !body.toAgentId) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'to_agent_id required');
          if (!body.text) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'text required');
          tool = 'agent_report';
          args = {
            from_agent_id: tileId,
            to_agent_id: body.to_agent_id || body.toAgentId,
            text: body.text,
            priority: body.priority || 'normal',
            ...(body.task_id || body.taskId ? { task_id: body.task_id || body.taskId } : {}),
            ...(body.result_summary || body.resultSummary ? { result_summary: body.result_summary || body.resultSummary } : {}),
          };
        } else {
          if (!body.text) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'text required');
          const selector = body.selector && typeof body.selector === 'object' ? body.selector : {};
          tool = 'agent_broadcast';
          args = {
            from_agent_id: tileId,
            text: body.text,
            selector: {
              ...selector,
              ...(body.role ? { role: body.role } : {}),
              ...(body.runtime ? { runtime: body.runtime } : {}),
              ...(body.status ? { status: body.status } : {}),
              ...(body.capability ? { capability: body.capability } : {}),
            },
          };
        }
        const out = await contex.call(tool, args);
        return sendJson(res, 200, { ok: true, tool, result: out });
      }
      const timelineRoute = path.match(/^\/api\/contex\/timeline(?:\/([^/]+))?$/);
      if (timelineRoute && method === 'GET') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const tileId = timelineRoute[1] ? decodeURIComponent(timelineRoute[1]) : '';
        const since = Number(url.searchParams.get('since_sequence') || 0);
        const limit = Number(url.searchParams.get('limit') || 50);
        const args = {
          workspace_id: contex.workspaceId,
          since_sequence: Number.isFinite(since) ? since : 0,
          limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.round(limit))) : 50,
        };
        const out = tileId
          ? await contex.call('get_agent_timeline', { ...args, tile_id: tileId, agent_id: tileId })
          : await contex.call('get_workspace_timeline', args);
        return sendJson(res, 200, {
          workspace_id: out?.workspace_id || contex.workspaceId,
          tile_id: tileId || out?.tile_id || null,
          events: Array.isArray(out?.events) ? out.events : [],
          event_count: Number.isFinite(out?.event_count) ? out.event_count : (Array.isArray(out?.events) ? out.events.length : 0),
        });
      }
      const taskRoute = path.match(/^\/api\/contex\/tasks\/([^/]+)\/status$/);
      if (taskRoute && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        if (!body.status) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'status required');
        const out = await contex.call('update_task', {
          workspace_id: contex.workspaceId,
          task_id: decodeURIComponent(taskRoute[1]),
          status: body.status,
          tile_id: body.tile_id || body.tileId || '',
          note: body.note || '',
        });
        return sendJson(res, 200, { ok: true, result: out });
      }
      if (path === '/api/contex/claims/release' && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        if (!body.path && !body.claim_id) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'path or claim_id required');
        const out = await contex.call('release_file_claim', {
          workspace_id: contex.workspaceId,
          tile_id: body.tile_id || body.tileId || '',
          path: body.path || '',
          claim_id: body.claim_id || body.claimId || '',
        });
        return sendJson(res, 200, { ok: true, result: out });
      }
      if (path === '/api/contex/polly/actions' && method === 'POST') {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const body = (await readBody(req)) || {};
        if (!body.item_id && !body.itemId) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'item_id required');
        if (!body.action) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'action required');
        if (!body.registry_path && !body.registryPath && !body.registry_hash && !body.registryHash) {
          throw new CodeSurfError('CODESURF_BAD_REQUEST', 'registry_hash or registry_path required');
        }
        const out = await contex.call('polly_request_action', {
          workspace_id: contex.workspaceId,
          registry_path: body.registry_path || body.registryPath || '',
          registry_hash: body.registry_hash || body.registryHash || '',
          item_id: body.item_id || body.itemId,
          action: body.action,
          reason: body.reason || '',
          payload: body.payload || {},
          requested_by_tile_id: body.requested_by_tile_id || body.requestedByTileId || '',
        });
        return sendJson(res, 200, { ok: true, result: out });
      }

      // ---- Contex objective / skill / context controls (Phase 7) ----
      const contextRoute = path.match(/^\/api\/contex\/context\/([^/]+)(?:\/(objective|skills|attachments|reload))?$/);
      if (contextRoute) {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const tileId = decodeURIComponent(contextRoute[1]);
        const action = contextRoute[2];
        if (!action && method === 'GET') {
          const out = await contex.call('get_context', { tile_id: tileId });
          return sendJson(res, 200, { context: out });
        }
        if (action === 'objective' && method === 'POST') {
          const body = (await readBody(req)) || {};
          const out = await contex.call('set_objective', {
            tile_id: tileId,
            markdown: String(body.markdown || ''),
            rules: Array.isArray(body.rules) ? body.rules : [],
            generated_by: body.generated_by || 'codesurf',
          });
          return sendJson(res, 200, { ok: true, result: out });
        }
        if (action === 'skills' && method === 'POST') {
          const body = (await readBody(req)) || {};
          if (!body.skill_key) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'skill_key required');
          const out = await contex.call('set_skill', {
            tile_id: tileId,
            skill_key: body.skill_key,
            enabled: body.enabled !== false,
            source: body.source || 'codesurf',
          });
          return sendJson(res, 200, { ok: true, result: out });
        }
        if (action === 'attachments' && method === 'POST') {
          const body = (await readBody(req)) || {};
          if (!body.uri) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'uri required');
          const out = await contex.call('add_context_attachment', {
            tile_id: tileId,
            kind: body.kind || 'file',
            label: body.label || body.uri,
            uri: body.uri,
            content_hash: body.content_hash || '',
          });
          return sendJson(res, 200, { ok: true, result: out });
        }
        if (action === 'reload' && method === 'POST') {
          const out = await contex.call('reload_objective', { tile_id: tileId });
          return sendJson(res, 200, { ok: true, result: out });
        }
        return sendJson(res, 405, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad context route' } });
      }

      // ---- chat tiles (Phase 6: human ↔ agent) ----
      const chat = path.match(/^\/api\/contex\/chat\/([^/]+)\/(register|send|messages)$/);
      if (chat) {
        if (!contex) return sendJson(res, 503, { error: { code: 'CODESURF_NO_CONTEX', message: 'Contex not connected' } });
        const tileId = decodeURIComponent(chat[1]);
        if (chat[2] === 'register' && method === 'POST') {
          await contex.call('peer_set_state', { tile_id: tileId, tile_type: 'chat', status: 'idle', task: 'chat tile' });
          return sendJson(res, 200, { ok: true });
        }
        if (chat[2] === 'send' && method === 'POST') {
          const body = (await readBody(req)) || {};
          if (!body.text) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'text required');
          const recipients = Array.isArray(body.recipients) ? body.recipients : (body.to ? [body.to] : []);
          const results = [];
          for (const to of recipients) {
            try { await contex.call('peer_send_message', { from_tile_id: tileId, to_tile_id: to, text: body.text }); results.push({ to, ok: true }); }
            catch (e) { results.push({ to, ok: false, error: e.message }); } // e.g. no canvas link to that peer
          }
          return sendJson(res, 200, { ok: true, delivered: results });
        }
        if (chat[2] === 'messages' && method === 'GET') {
          const out = await contex.call('peer_read_messages', { tile_id: tileId, unread_only: false });
          return sendJson(res, 200, { messages: out?.messages || [] });
        }
        return sendJson(res, 405, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad chat route' } });
      }

      // ---- Terminal tiles (M5) ----
      const term = path.match(/^\/api\/terminals\/([^/]+)(?:\/(start|input|control|stop|stream|resize))?$/);
      if (term) {
        if (!terminals) return sendJson(res, 503, { error: { code: 'CODESURF_NO_TERMINALS', message: 'terminals not enabled' } });
        const tileId = decodeURIComponent(term[1]);
        const action = term[2];
        if (!action && method === 'GET') {
          return sendJson(res, 200, { ...terminals.status(tileId), scrollback: terminals.scrollback(tileId) });
        }
        if (action === 'stream' && method === 'GET') return streamTerminal(req, res, terminals, tileId);
        if (action === 'start' && method === 'POST') {
          const body = (await readBody(req)) || {};
          if (!body.command) throw new CodeSurfError('CODESURF_BAD_REQUEST', 'command required');
          const started = terminals.start(tileId, {
            command: body.command,
            args: Array.isArray(body.args) ? body.args : undefined,
            cwd: body.cwd,
            env: body.env && typeof body.env === 'object' ? body.env : undefined,
            cols: Number(body.cols),
            rows: Number(body.rows),
          });
          return sendJson(res, 200, { ok: true, command: started });
        }
        if (action === 'input' && method === 'POST') {
          const body = (await readBody(req)) || {};
          terminals.write(tileId, body.data ?? '');
          return sendJson(res, 200, { ok: true });
        }
        if (action === 'control' && method === 'POST') {
          const body = (await readBody(req)) || {};
          terminals.control(tileId, body.action);
          return sendJson(res, 200, { ok: true });
        }
        if (action === 'resize' && method === 'POST') {
          const body = (await readBody(req)) || {};
          terminals.resize(tileId, Number(body.cols), Number(body.rows));
          return sendJson(res, 200, { ok: true });
        }
        if (action === 'stop' && method === 'POST') {
          terminals.stop(tileId);
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 405, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad terminal route' } });
      }

      // ---- API ----
      if (path === '/api/workspaces' && method === 'GET') {
        return sendJson(res, 200, { workspaces: store.listWorkspaces({ includeArchived: url.searchParams.get('all') === '1' }) });
      }
      if (path === '/api/workspaces' && method === 'POST') {
        const body = (await readBody(req)) || {};
        const meta = store.createWorkspace({ name: body.name, repositoryPath: body.repositoryPath });
        return sendJson(res, 201, meta);
      }

      const wsMatch = path.match(/^\/api\/workspaces\/([^/]+)$/);
      if (wsMatch && method === 'GET') {
        return sendJson(res, 200, store.openWorkspace(decodeURIComponent(wsMatch[1])));
      }

      const layoutMatch = path.match(/^\/api\/workspaces\/([^/]+)\/layout$/);
      if (layoutMatch && method === 'PUT') {
        const id = decodeURIComponent(layoutMatch[1]);
        const body = (await readBody(req)) || {};
        const layout = store.saveLayout(id, body.layout ?? body);
        return sendJson(res, 200, { ok: true, layout });
      }

      const fileMatch = path.match(/^\/api\/workspaces\/([^/]+)\/file$/);
      if (fileMatch && method === 'GET') {
        const id = decodeURIComponent(fileMatch[1]);
        const relPath = url.searchParams.get('path') || '';
        const { meta } = store.openWorkspace(id);
        const file = resolveRepoFile(meta.repositoryPath, relPath);
        let content;
        try { content = await readFile(file, 'utf8'); }
        catch { throw new CodeSurfError('CODESURF_NOT_FOUND', `repository file not found: ${relPath}`); }
        return sendJson(res, 200, { path: relPath, content, bytes: Buffer.byteLength(content) });
      }

      const gitRoute = path.match(/^\/api\/workspaces\/([^/]+)\/git(?:\/(status|worktrees))?$/);
      if (gitRoute) {
        const id = decodeURIComponent(gitRoute[1]);
        const action = gitRoute[2] || 'status';
        const { meta } = store.openWorkspace(id);
        if (action === 'status' && method === 'GET') {
          return sendJson(res, 200, await gitStatus(meta.repositoryPath));
        }
        if (action === 'worktrees' && method === 'GET') {
          return sendJson(res, 200, await gitWorktrees(meta.repositoryPath));
        }
        if (action === 'worktrees' && method === 'POST') {
          const body = (await readBody(req)) || {};
          return sendJson(res, 201, await createGitWorktree(meta.repositoryPath, body));
        }
        return sendJson(res, 405, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad git route' } });
      }

      const memoryRoute = path.match(/^\/api\/workspaces\/([^/]+)\/memory(?:\/(proposal|accept|pins|markers))?$/);
      if (memoryRoute) {
        const id = decodeURIComponent(memoryRoute[1]);
        const action = memoryRoute[2];
        store.openWorkspace(id);
        if (!action && method === 'GET') {
          return sendJson(res, 200, { memory: store.loadMemory(id) });
        }
        if (action === 'proposal' && method === 'POST') {
          return sendJson(res, 200, { proposal: await buildMemoryProposal({ store, workspaceId: id, contex }) });
        }
        if (action === 'accept' && method === 'POST') {
          const body = (await readBody(req)) || {};
          return sendJson(res, 200, { memory: applyMemoryProposal(store, id, body.proposal || {}) });
        }
        if (action === 'pins' && method === 'POST') {
          const body = (await readBody(req)) || {};
          return sendJson(res, 200, { memory: addMemoryPin(store, id, body.text || '') });
        }
        if (action === 'markers' && method === 'POST') {
          const body = (await readBody(req)) || {};
          return sendJson(res, 200, { memory: addMemoryMarker(store, id, body) });
        }
        return sendJson(res, 405, { error: { code: 'CODESURF_BAD_REQUEST', message: 'bad memory route' } });
      }

      const closeMatch = path.match(/^\/api\/workspaces\/([^/]+)\/close$/);
      if (closeMatch && method === 'POST') {
        store.closeWorkspace(decodeURIComponent(closeMatch[1]));
        return sendJson(res, 200, { ok: true });
      }

      // ---- vendored xterm assets (optional) ----
      if (method === 'GET' && VENDOR[path]) return serveVendor(res, VENDOR[path]);

      // ---- static assets (any GET that isn't an API route) ----
      if (method === 'GET' && !path.startsWith('/api/')) return serveStatic(res, path);

      sendJson(res, 404, { error: { code: 'CODESURF_NOT_FOUND', message: `no route: ${method} ${path}` } });
    } catch (err) {
      sendError(res, err);
    }
  };
}

async function serveVendor(res, entry) {
  try {
    const buf = await readFile(join(NODE_MODULES, entry.file));
    res.writeHead(200, { 'content-type': entry.type, 'content-length': buf.length, 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    if (entry.type.startsWith('text/css')) {
      return sendText(res, 200, '', entry.type);
    }
    sendJson(res, 404, { error: { code: 'CODESURF_NOT_FOUND', message: `vendor asset missing (run npm install): ${entry.file}` } });
  }
}

function sendText(res, status, text, type) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text), 'cache-control': 'no-cache' });
  res.end(text);
}

/** Forward Contex notifications/status to the browser over SSE. */
function streamContexEvents(req, res, contex) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`event: status\ndata: ${JSON.stringify({ status: contex.status })}\n\n`);
  const onEvent = (n) => res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
  const onStatus = (s) => res.write(`event: status\ndata: ${JSON.stringify({ status: s })}\n\n`);
  const onTile = (p) => res.write(`event: tile_state\ndata: ${JSON.stringify(p)}\n\n`);
  const onCommand = (c) => res.write(`event: command\ndata: ${JSON.stringify(c)}\n\n`);
  contex.on('event', onEvent);
  contex.on('status', onStatus);
  contex.on('tile_state', onTile);
  contex.on('command', onCommand);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepalive);
    contex.off('event', onEvent);
    contex.off('status', onStatus);
    contex.off('tile_state', onTile);
    contex.off('command', onCommand);
  });
}

/** Stream a terminal tile's scrollback + live output/exit to the browser via SSE. */
function streamTerminal(req, res, terminals, tileId) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const status = terminals.status(tileId);
  res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
  const back = terminals.scrollback(tileId);
  if (back) res.write(`event: data\ndata: ${JSON.stringify({ chunk: back })}\n\n`);
  const onData = (e) => { if (e.tileId === tileId) res.write(`event: data\ndata: ${JSON.stringify({ chunk: e.data })}\n\n`); };
  const onExit = (e) => { if (e.tileId === tileId) res.write(`event: exit\ndata: ${JSON.stringify(e)}\n\n`); };
  const onStarted = (e) => { if (e.tileId === tileId) res.write(`event: status\ndata: ${JSON.stringify(terminals.status(tileId))}\n\n`); };
  terminals.on('data', onData);
  terminals.on('exit', onExit);
  terminals.on('started', onStarted);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepalive);
    terminals.off('data', onData);
    terminals.off('exit', onExit);
    terminals.off('started', onStarted);
  });
}

/** Create (but do not listen on) an http.Server bound to a store + optional Contex + terminals. */
export function createServer(store, contex = null, terminals = null) {
  return httpCreateServer(createHandler(store, contex, terminals));
}

/** Start the loopback server. Resolves with { server, url, port }. */
export function startServer({ store, contex = null, terminals = null, host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(store, contex, terminals);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: `http://${host}:${addr.port}/` });
    });
  });
}
