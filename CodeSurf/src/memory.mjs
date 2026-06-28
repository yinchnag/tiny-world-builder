import { gitStatus } from './git.mjs';

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g,
  /\b([A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@)/g,
];

export function redactMemoryValue(value) {
  if (Array.isArray(value)) return value.map(redactMemoryValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|password|authorization|api[_-]?key|bearer/i.test(key)) out[key] = '[redacted]';
      else out[key] = redactMemoryValue(item);
    }
    return out;
  }
  if (typeof value !== 'string') return value;
  return SECRET_VALUE_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), value);
}

function evidence(kind, label, value) {
  return { id: `ev_${kind}`, kind, label, value: redactMemoryValue(value) };
}

function summarizeTiles(layout) {
  return (layout.tiles || []).map((tile) => ({
    id: tile.id,
    type: tile.type,
    title: tile.title,
    status: tile.status,
    dataKeys: Object.keys(tile.data || {}).filter((key) => !/token|secret|password|authorization/i.test(key)),
  }));
}

function section(title, body, evidenceIds = []) {
  return { title, body, evidenceIds };
}

export async function buildMemoryProposal({ store, workspaceId, contex = null }) {
  const { meta, layout } = store.openWorkspace(workspaceId);
  const memory = store.loadMemory(workspaceId);
  const ev = [
    evidence('workspace', 'Workspace metadata', { id: meta.id, name: meta.name, repositoryPath: meta.repositoryPath }),
    evidence('layout', 'Canvas tiles and links', { tiles: summarizeTiles(layout), links: layout.links || [] }),
  ];

  let git = null;
  try {
    git = await gitStatus(meta.repositoryPath);
    ev.push(evidence('git', 'Git branch and dirty files', {
      branch: git.branch,
      dirty: git.dirty,
      files: git.files,
      diffStat: git.diffStat,
      worktrees: git.worktrees,
    }));
  } catch (err) {
    ev.push(evidence('git', 'Git unavailable', { message: err.message }));
  }

  let tasks = [];
  let claims = [];
  if (contex) {
    try {
      const taskOut = await contex.call('list_tasks', { workspace_id: contex.workspaceId });
      tasks = Array.isArray(taskOut?.tasks) ? taskOut.tasks : Array.isArray(taskOut) ? taskOut : [];
      ev.push(evidence('tasks', 'Contex tasks', tasks));
    } catch {
      ev.push(evidence('tasks', 'Contex tasks unavailable', []));
    }
    try {
      const claimOut = await contex.call('list_file_claims', { workspace_id: contex.workspaceId });
      claims = Array.isArray(claimOut?.claims) ? claimOut.claims : Array.isArray(claimOut) ? claimOut : [];
      ev.push(evidence('claims', 'Contex file claims', claims));
    } catch {
      ev.push(evidence('claims', 'Contex file claims unavailable', []));
    }
  }

  const tileCount = (layout.tiles || []).length;
  const openTasks = tasks.filter((task) => !['done', 'completed', 'cancelled'].includes(String(task.status || '').toLowerCase())).length;
  const localFiles = git?.files?.length || 0;
  const pins = memory.pins || [];
  const staleMarkers = (memory.markers || []).filter((m) => m.kind === 'stale');
  const sections = [
    section('Overview', `${meta.name} has ${tileCount} tile${tileCount === 1 ? '' : 's'} on the canvas, ${openTasks} open task${openTasks === 1 ? '' : 's'}, and ${localFiles} local Git change${localFiles === 1 ? '' : 's'}.`, ['ev_workspace', 'ev_layout']),
    section('Durable Facts', pins.length ? pins.map((pin) => `- ${pin.text}`).join('\n') : '- No user-pinned facts yet.', pins.map((pin) => pin.id).filter(Boolean)),
    section('Open Threads', tasks.length ? tasks.map((task) => `- ${task.title || task.summary || task.id || 'task'}: ${task.status || 'open'}`).join('\n') : '- No Contex tasks available.'),
    section('Uncommitted / Local-only Work', git?.files?.length ? git.files.map((file) => `- ${file.status} ${file.path}`).join('\n') : '- Git reports a clean working tree or Git is unavailable.'),
    section('Stale / Contested Memory', staleMarkers.length ? staleMarkers.map((m) => `- ${m.text}`).join('\n') : '- No stale memory markers.'),
  ];

  return redactMemoryValue({
    generatedAt: new Date().toISOString(),
    workspaceId,
    sections,
    evidence: ev,
    pins,
    markers: memory.markers || [],
    claims,
  });
}

export function applyMemoryProposal(store, workspaceId, proposal) {
  const current = store.loadMemory(workspaceId);
  return store.saveMemory(workspaceId, {
    ...current,
    generated: redactMemoryValue(proposal),
    updatedAt: new Date().toISOString(),
  });
}

export function addMemoryPin(store, workspaceId, text) {
  const memory = store.loadMemory(workspaceId);
  const pin = { id: `pin_${Date.now().toString(16)}`, text: String(text || '').trim(), at: new Date().toISOString() };
  if (!pin.text) return memory;
  return store.saveMemory(workspaceId, { ...memory, pins: [...memory.pins, redactMemoryValue(pin)], updatedAt: new Date().toISOString() });
}

export function addMemoryMarker(store, workspaceId, { kind = 'correction', text = '', target = '' } = {}) {
  const memory = store.loadMemory(workspaceId);
  const marker = {
    id: `mem_${Date.now().toString(16)}`,
    kind: kind === 'stale' ? 'stale' : 'correction',
    target: String(target || ''),
    text: String(text || '').trim(),
    at: new Date().toISOString(),
  };
  if (!marker.text) return memory;
  return store.saveMemory(workspaceId, { ...memory, markers: [...memory.markers, redactMemoryValue(marker)], updatedAt: new Date().toISOString() });
}
