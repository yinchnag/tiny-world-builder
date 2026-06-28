// contex.mjs — optional Polly -> Contex observe-only bridge.
//
// Polly remains registry-first and headless. This adapter observes registry
// saves and best-effort pushes snapshots to Contex via MCP `polly_sync_snapshot`.
// Sync failures are retained for status/logging but never block the orchestrator.

export function contexOptionsFromEnv(env = process.env) {
  return {
    url: env.CONTEX_URL || null,
    token: env.CONTEX_TOKEN || null,
    workspace: env.CONTEX_WORKSPACE || null,
    enabled: env.POLLY_CONTEX_SYNC === '1' || env.POLLY_CONTEX_SYNC === 'true',
  };
}

export function contexOptionsFromCli(opts = {}, env = process.env) {
  const fromEnv = contexOptionsFromEnv(env);
  const url = opts['contex-url'] || fromEnv.url;
  const token = resolveSecret(opts['contex-token'] || fromEnv.token, env);
  const workspace = opts['contex-workspace'] || fromEnv.workspace;
  const enabled = Boolean(opts.contex || opts['contex-url'] || opts['contex-token'] || opts['contex-workspace'] || fromEnv.enabled);
  return { enabled, url, token, workspace };
}

export function createContexSyncFromOptions(opts = {}, { registryPath, repoPath, fetchImpl = globalThis.fetch, logger = console } = {}) {
  if (!opts.enabled) return null;
  if (!opts.url) throw new Error('Contex sync enabled but no --contex-url or CONTEX_URL was provided');
  if (!opts.token) throw new Error('Contex sync enabled but no --contex-token or CONTEX_TOKEN was provided');
  if (!opts.workspace) throw new Error('Contex sync enabled but no --contex-workspace or CONTEX_WORKSPACE was provided');
  return createContexSync({
    url: normalizeMcpUrl(opts.url),
    token: opts.token,
    workspaceId: opts.workspace,
    registryPath,
    repoPath,
    fetchImpl,
    logger,
  });
}

export function createContexSync({
  url,
  token,
  workspaceId,
  registryPath,
  repoPath,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  if (!url || !token || !workspaceId || !registryPath) throw new Error('Contex sync requires url, token, workspaceId, and registryPath');
  let session = null;
  let id = 1;
  let pending = Promise.resolve();
  let lastError = null;
  const state = { attempted: 0, succeeded: 0, failed: 0 };

  async function post(message) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    };
    if (session) headers['mcp-session-id'] = session;
    const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(message) });
    const sid = res.headers?.get?.('mcp-session-id');
    if (sid) session = sid;
    const text = await res.text();
    const body = text ? parseMcpBody(text, res.headers?.get?.('content-type')) : null;
    if (!res.ok) throw new Error(`Contex HTTP ${res.status}`);
    if (body?.error) throw new Error(body.error.message || body.error.code || 'Contex MCP error');
    return body;
  }

  async function initialize() {
    if (session) return;
    await post({
      jsonrpc: '2.0',
      id: id++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'polly-arranger', version: '0.0.0' },
      },
    });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async function call(name, args = {}) {
    await initialize();
    const body = await post({
      jsonrpc: '2.0',
      id: id++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const result = body?.result;
    if (result?.isError) {
      const e = result.structuredContent?.error;
      throw new Error(e?.message || e?.code || 'Contex tool error');
    }
    return result?.structuredContent ?? parseTextResult(result);
  }

  async function syncNow(registry) {
    state.attempted += 1;
    try {
      const result = await call('polly_sync_snapshot', {
        workspace_id: workspaceId,
        registry_path: registryPath,
        repo_path: repoPath,
        policy: registry.policy || {},
        vendors: registry.vendors || [],
        items: registry.items || [],
        idempotency_key: snapshotKey(registryPath, registry),
      });
      state.succeeded += 1;
      lastError = null;
      return result;
    } catch (err) {
      state.failed += 1;
      lastError = err;
      logger?.warn?.(`Contex sync failed: ${err.message}`);
      return null;
    }
  }

  function schedule(registry) {
    pending = pending.then(() => syncNow(registry));
    return pending;
  }

  async function listActionRequests({ pendingOnly = true, sinceSequence = 0, limit = 100 } = {}) {
    return call('polly_list_action_requests', {
      workspace_id: workspaceId,
      registry_path: registryPath,
      pending_only: pendingOnly,
      since_sequence: sinceSequence,
      limit,
    });
  }

  async function recordActionResult({ requestId, status, message = '', payload = {} } = {}) {
    return call('polly_record_action_result', {
      workspace_id: workspaceId,
      request_id: requestId,
      status,
      message,
      payload,
    });
  }

  return {
    schedule,
    listActionRequests,
    recordActionResult,
    flush: () => pending,
    status: () => ({ ...state, lastError: lastError?.message || null }),
  };
}

export function createContexSyncedStore(store, contexSync) {
  if (!contexSync) return store;
  return {
    load: store.load,
    save(path, reg) {
      const saved = store.save(path, reg);
      contexSync.schedule(saved);
      return saved;
    },
  };
}

function normalizeMcpUrl(url) {
  const text = String(url || '').replace(/\/+$/, '');
  return text.endsWith('/mcp') ? text : `${text}/mcp`;
}

function resolveSecret(value, env) {
  if (!value) return null;
  const text = String(value);
  if (text.startsWith('env:')) return env[text.slice(4)] || null;
  return text;
}

function snapshotKey(registryPath, registry) {
  const items = Array.isArray(registry.items) ? registry.items : [];
  const bits = items.map((item) => [
    item.id,
    item.status,
    item.pr ?? '',
    item.branch ?? '',
    item.worktree ?? '',
    item.reviewRound ?? '',
    item.mergedAt ?? '',
    item.blockedOn ?? '',
  ].join(':')).join('|');
  return `polly:${registryPath}:${hashString(bits)}`;
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function parseMcpBody(text, contentType) {
  if (contentType && contentType.includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).pop();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}

function parseTextResult(result) {
  const text = result?.content?.find?.((entry) => entry.type === 'text')?.text || '{}';
  try { return JSON.parse(text); } catch { return { text }; }
}
