// CodeSurf tile host — pure model + registry (M3).
//
// This module has NO DOM dependency on purpose: the browser imports it over
// HTTP (/tiles.mjs) and Node tests import it from disk, so the registry,
// serialization, unknown-type handling, error boundary, and focus order are all
// unit-testable without a browser. Anything touching `document` lives in
// canvas.js, never here.

export const MIN_W = 120;
export const MIN_H = 80;

// Small pure HTML escaper (the canvas has its own DOM-side copy).
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- registry -----------------------------------------------------------

/** A registry of tile-type definitions. The canvas core never names a concrete
 *  type — it only goes through here, so a new type is "register and done". */
export class TileRegistry {
  constructor() { this.defs = new Map(); }

  register(def) {
    if (!def || typeof def.type !== 'string') throw new Error('tile def needs a string type');
    const full = {
      type: def.type,
      label: def.label || def.type,
      defaultSize: { w: def.defaultSize?.w ?? 220, h: def.defaultSize?.h ?? 140 },
      capabilities: Array.isArray(def.capabilities) ? def.capabilities.slice() : [],
      renderBody: typeof def.renderBody === 'function' ? def.renderBody : () => '',
      unknown: false,
    };
    this.defs.set(full.type, full);
    return this;
  }

  has(type) { return this.defs.has(type); }
  list() { return [...this.defs.values()]; }

  /** Always returns a usable def; an unregistered type yields a placeholder
   *  that preserves the original type + data (forward-compat). */
  get(type) {
    return this.defs.get(type) || unknownDef(type);
  }
}

function unknownDef(type) {
  return {
    type,
    label: `Unknown (${type})`,
    defaultSize: { w: 220, h: 140 },
    capabilities: [],
    unknown: true,
    renderBody: (t) => {
      const data = t && t.data && Object.keys(t.data).length
        ? `<pre class="raw">${escapeHtml(JSON.stringify(t.data, null, 2))}</pre>` : '';
      return `<p class="muted">No renderer for tile type <b>${escapeHtml(String(type))}</b>. ` +
             `Its data is preserved so a future build can restore it.</p>${data}`;
    },
  };
}

// ---- tile model + serialization -----------------------------------------

const STATUSES = new Set(['idle', 'working', 'waiting', 'blocked', 'paused', 'done', 'error', 'offline']);

function clampSize(v, min, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.round(n));
}

/** Coerce a raw tile (from disk, the network, or `+ Tile`) into canonical shape.
 *  Marks `unknown: true` when the type has no registered renderer. */
export function normalizeTile(raw, registry) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = typeof r.type === 'string' ? r.type : 'note';
  const def = registry.get(type);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : genId('tile'),
    type,
    title: typeof r.title === 'string' ? r.title : def.label,
    x: Number.isFinite(r.x) ? Math.round(r.x) : 0,
    y: Number.isFinite(r.y) ? Math.round(r.y) : 0,
    w: clampSize(r.w, MIN_W, def.defaultSize.w),
    h: clampSize(r.h, MIN_H, def.defaultSize.h),
    minimized: !!r.minimized,
    pinned: !!r.pinned,
    status: STATUSES.has(r.status) ? r.status : 'idle',
    data: r.data && typeof r.data === 'object' ? r.data : {},
    unknown: !!def.unknown,
  };
}

/** Persisted form — derived fields (`unknown`) are dropped; type + data are kept
 *  verbatim so an unknown tile round-trips losslessly. */
export function serializeTile(tile) {
  return {
    id: tile.id, type: tile.type, title: tile.title,
    x: tile.x, y: tile.y, w: tile.w, h: tile.h,
    minimized: !!tile.minimized, pinned: !!tile.pinned,
    status: tile.status, data: tile.data || {},
  };
}

export function deserializeTile(raw, registry) {
  return normalizeTile(raw, registry);
}

// ---- error boundary -----------------------------------------------------

/** Render a tile body, catching a throwing renderer so one bad tile can never
 *  crash the canvas. Returns { ok, html }. */
export function safeRender(def, tile) {
  try {
    return { ok: true, html: String(def.renderBody(tile) ?? '') };
  } catch (err) {
    return { ok: false, html:
      `<div class="tile-error">⚠ tile renderer failed: ${escapeHtml(err && err.message || String(err))}</div>` };
  }
}

// ---- focus order --------------------------------------------------------

/** Reading-order traversal (top-to-bottom, then left-to-right) for Tab focus
 *  and the accessible object list. Pinned tiles come first. */
export function focusOrder(tiles) {
  return [...tiles]
    .sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)))
    .map((t) => t.id);
}

// ---- ids (works in browser + node) --------------------------------------

function genId(prefix) {
  const uuid = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return `${prefix}_${uuid}`;
}

// ---- default registry ---------------------------------------------------

/** The built-in tile types. Terminal/chat/etc. are lightweight placeholders in
 *  M3 — their capabilities mirror Contex's type-derived tool gating (e.g. a
 *  terminal advertises `terminal_input`, which Phase-8 `terminal_send_input`
 *  requires). Real behavior arrives in M4 (Contex client) and M5 (terminal). */
export function createDefaultRegistry() {
  const reg = new TileRegistry();
  reg.register({
    type: 'note', label: 'Note', defaultSize: { w: 220, h: 140 }, capabilities: [],
    renderBody: (t) => t.data.note
      ? `<p>${escapeHtml(t.data.note)}</p>`
      : '<p class="muted">Note tile. Double-click to edit (M3+).</p>',
  });
  reg.register({
    type: 'terminal', label: 'Terminal', defaultSize: { w: 420, h: 300 }, capabilities: ['terminal_input'],
    // static shell; canvas.js mounts xterm.js into .term-screen (or a <pre>
    // fallback) and wires the live process stream + input
    renderBody: (t) => `<div class="term">
      <div class="term-bar">
        <input class="term-cmd" placeholder="command e.g. node, claude, codex" value="${escapeHtml(t.data.command || '')}" />
        <button class="term-start" title="Start process">▶</button>
        <button class="term-stop" title="Stop process">■</button>
      </div>
      <div class="term-screen"></div>
    </div>`,
  });
  reg.register({
    type: 'agent', label: 'Agent', defaultSize: { w: 460, h: 330 }, capabilities: ['agent', 'chat', 'terminal_input'],
    renderBody: (t) => {
      const profile = t.data.agentProfile || {};
      const role = profile.role || t.data.env?.AGENT_ROLE || 'worker';
      const runtime = profile.runtime || t.data.env?.AGENT_RUNTIME || 'codex';
      const model = profile.model || t.data.env?.AGENT_MODEL || 'default';
      return `<div class="agent-tile">
        <div class="agent-strip">
          <span>${escapeHtml(role)}</span>
          <span>${escapeHtml(runtime)}</span>
          <span>${escapeHtml(model || 'default')}</span>
        </div>
        <section class="agent-handoff" hidden aria-label="Human attention required">
          <div class="agent-handoff-head">
            <b>Waiting for human</b>
            <span class="agent-handoff-status">blocked</span>
          </div>
          <p class="agent-handoff-question">Agent needs human input.</p>
          <textarea class="agent-handoff-reply" rows="2" placeholder="Reply to this Agent"></textarea>
          <div class="agent-handoff-actions">
            <button class="agent-handoff-send" type="button">Reply and continue</button>
            <button class="agent-handoff-reject" type="button">Reject</button>
            <button class="agent-handoff-handled" type="button">Mark handled</button>
          </div>
        </section>
        <section class="agent-actions" aria-label="Agent collaboration actions">
          <div class="agent-actions-head">
            <b>Actions</b>
            <button class="agent-actions-toggle" type="button" title="Show or hide Agent actions">Open</button>
          </div>
          <div class="agent-actions-body" hidden>
            <div class="agent-actions-grid">
              <input class="agent-action-task" placeholder="task id" aria-label="Task id" />
              <input class="agent-action-target" placeholder="target agent id" aria-label="Target Agent id" />
              <select class="agent-action-role" aria-label="Broadcast role">
                <option value="">role</option>
                <option value="worker">worker</option>
                <option value="reviewer">reviewer</option>
                <option value="coordinator">coordinator</option>
                <option value="planner">planner</option>
                <option value="researcher">researcher</option>
              </select>
            </div>
            <textarea class="agent-action-text" rows="2" placeholder="message / result summary"></textarea>
            <div class="agent-action-buttons">
              <button class="agent-action-claim" type="button">Claim</button>
              <button class="agent-action-complete" type="button">Complete</button>
              <button class="agent-action-handoff" type="button">Handoff</button>
              <button class="agent-action-report" type="button">Report</button>
              <button class="agent-action-broadcast" type="button">Broadcast</button>
            </div>
            <p class="agent-action-status">Actions use Contex link and task policy.</p>
          </div>
        </section>
        <div class="term">
          <div class="term-bar">
            <input class="term-cmd" placeholder="agent runtime command" value="${escapeHtml(t.data.command || '')}" />
            <button class="term-start" title="Start agent">▶</button>
            <button class="term-stop" title="Stop agent">■</button>
          </div>
          <div class="term-screen"></div>
        </div>
        <section class="agent-activity" aria-label="Agent activity">
          <div class="agent-activity-head">
            <b>Activity</b>
            <button class="agent-activity-refresh" type="button" title="Refresh activity">Refresh</button>
          </div>
          <div class="agent-activity-list empty">No timeline loaded.</div>
        </section>
      </div>`;
    },
  });
  reg.register({
    type: 'chat', label: 'Chat', defaultSize: { w: 340, h: 300 }, capabilities: ['chat'],
    // shell; canvas.js wires it to Contex messaging (send to linked agents, show replies)
    renderBody: () => `<div class="chat">
      <div class="chat-log"></div>
      <div class="chat-bar">
        <input class="chat-input" placeholder="message linked agents — Enter to send" />
        <button class="chat-send" title="Send">Send</button>
      </div>
    </div>`,
  });
  reg.register({
    type: 'status', label: 'Status', defaultSize: { w: 360, h: 220 }, capabilities: [],
    renderBody: () => `<div class="status-tile">
      <div class="status-tile-bar">
        <button class="status-refresh" type="button">Refresh</button>
        <span class="status-summary">Workspace status</span>
      </div>
      <div class="status-panels">
        <section class="status-panel" aria-label="Active work"><h4>Work</h4><div class="status-list status-tasks empty">No tasks loaded.</div></section>
        <section class="status-panel" aria-label="Polly Arranger"><h4>Polly</h4><div class="status-list status-polly empty">No Polly items loaded.</div></section>
        <section class="status-panel" aria-label="File claims"><h4>Claims</h4><div class="status-list status-claims empty">No file claims loaded.</div></section>
      </div>
    </div>`,
  });
  reg.register({
    type: 'git', label: 'Git', defaultSize: { w: 380, h: 300 }, capabilities: ['git_view'],
    renderBody: () => `<div class="git-tile">
      <div class="git-bar">
        <button class="git-refresh" type="button">Refresh</button>
        <span class="git-summary">Git status</span>
      </div>
      <div class="git-warning">Stage, commit, push, and PR actions are intentionally disabled in this slice.</div>
      <div class="git-section">
        <h4>Changes</h4>
        <div class="git-files empty">No Git status loaded.</div>
      </div>
      <div class="git-section">
        <h4>Worktrees</h4>
        <div class="git-worktrees empty">No worktrees loaded.</div>
      </div>
      <div class="git-create">
        <input class="git-worktree-path" placeholder="/absolute/path/to/worktree" aria-label="New worktree path" />
        <input class="git-worktree-branch" placeholder="codex/phase-10" aria-label="New worktree branch" />
        <button class="git-create-worktree" type="button">Create</button>
      </div>
    </div>`,
  });
  reg.register({
    type: 'memory', label: 'Memory', defaultSize: { w: 420, h: 340 }, capabilities: ['memory_view'],
    renderBody: (t) => {
      const memory = t.data.memory || {};
      const generated = memory.generated || t.data.proposal || null;
      const pins = Array.isArray(memory.pins) ? memory.pins : [];
      const markers = Array.isArray(memory.markers) ? memory.markers : [];
      return `<div class="memory-tile">
        <div class="memory-bar">
          <button class="memory-refresh" type="button">Refresh</button>
          <button class="memory-propose" type="button">Propose</button>
          <button class="memory-accept" type="button">Accept</button>
          <span class="memory-summary">${generated ? 'Proposal ready' : 'No proposal yet'}</span>
        </div>
        <div class="memory-sections">${renderMemorySections(generated)}</div>
        <div class="memory-evidence">${renderMemoryEvidence(generated)}</div>
        <div class="memory-controls">
          <input class="memory-pin-input" placeholder="Pin durable fact" />
          <button class="memory-add-pin" type="button">Pin</button>
          <input class="memory-marker-input" placeholder="Correction or stale note" />
          <button class="memory-add-correction" type="button">Correct</button>
          <button class="memory-add-stale" type="button">Stale</button>
        </div>
        <div class="memory-pins">${pins.map((pin) => `<div class="memory-note pinned">${escapeHtml(pin.text || '')}</div>`).join('')}</div>
        <div class="memory-markers">${markers.map((m) => `<div class="memory-note ${escapeHtml(m.kind || 'correction')}">${escapeHtml(m.text || '')}</div>`).join('')}</div>
      </div>`;
    },
  });
  reg.register({
    type: 'browser', label: 'Browser', defaultSize: { w: 420, h: 320 }, capabilities: ['browser_preview'],
    renderBody: (t) => {
      const url = t.data.url || '';
      const finding = t.data.finding || '';
      const findings = Array.isArray(t.data.findings) ? t.data.findings : [];
      return `<div class="browser-tile">
        <div class="browser-bar">
          <input class="browser-url" value="${escapeHtml(url)}" placeholder="http://127.0.0.1:3000/" aria-label="Browser URL" />
          <button class="browser-go" type="button" title="Load URL">Go</button>
          <button class="browser-reload" type="button" title="Reload preview">Reload</button>
        </div>
        <iframe class="browser-frame" src="${escapeHtml(url || 'about:blank')}" title="Browser preview"></iframe>
        <div class="browser-console" aria-label="Browser console summary">${escapeHtml(t.data.console || 'Preview idle.')}</div>
        <div class="browser-finding-row">
          <textarea class="browser-finding" rows="2" placeholder="Finding for linked agents">${escapeHtml(finding)}</textarea>
          <button class="browser-send-finding" type="button">Send</button>
        </div>
        <div class="browser-findings">${findings.map((f) =>
          `<div class="finding"><b>${escapeHtml(f.url || 'page')}</b><span>${escapeHtml(f.text || '')}</span></div>`).join('')}</div>
      </div>`;
    },
  });
  reg.register({
    type: 'document', label: 'Document', defaultSize: { w: 380, h: 320 }, capabilities: ['document_context'],
    renderBody: (t) => {
      const text = t.data.text || '';
      const filePath = t.data.filePath || '';
      const mode = t.data.mode === 'preview' ? 'preview' : 'edit';
      const comments = Array.isArray(t.data.comments) ? t.data.comments : [];
      return `<div class="document-tile" data-mode="${escapeHtml(mode)}">
        <div class="document-bar">
          <input class="document-file" value="${escapeHtml(filePath)}" placeholder="repo/path.md" aria-label="Repository file path" />
          <button class="document-load-file" type="button">Load</button>
          <button class="document-toggle" type="button">${mode === 'preview' ? 'Edit' : 'Preview'}</button>
        </div>
        <div class="document-presets">
          <button class="document-preset" type="button" data-preset="objective">Objective</button>
          <button class="document-preset" type="button" data-preset="spec">Spec</button>
          <button class="document-preset" type="button" data-preset="plan">Plan</button>
        </div>
        <textarea class="document-editor" rows="8" ${mode === 'preview' ? 'hidden' : ''}>${escapeHtml(text)}</textarea>
        <div class="document-preview" ${mode === 'preview' ? '' : 'hidden'}>${markdownPreview(text)}</div>
        <div class="document-comment-row">
          <input class="document-comment" placeholder="Comment or note" />
          <button class="document-add-comment" type="button">Add</button>
          <button class="document-send-selection" type="button">Send selection</button>
        </div>
        <div class="document-comments">${comments.map((c) =>
          `<div class="doc-comment"><span>${escapeHtml(c.at || '')}</span>${escapeHtml(c.text || '')}</div>`).join('')}</div>
        <div class="document-history">${Array.isArray(t.data.revisions) && t.data.revisions.length
          ? `${t.data.revisions.length} saved revision${t.data.revisions.length === 1 ? '' : 's'}` : 'No saved revisions yet.'}</div>
      </div>`;
    },
  });
  return reg;
}

function renderMemorySections(proposal) {
  const sections = Array.isArray(proposal?.sections) ? proposal.sections : [];
  return sections.length ? sections.map((s) => `<section class="memory-section"><h4>${escapeHtml(s.title || 'Section')}</h4><pre>${escapeHtml(s.body || '')}</pre></section>`).join('')
    : '<p class="muted">Generate a proposal from canvas, Git, tasks, and pinned facts.</p>';
}

function renderMemoryEvidence(proposal) {
  const evidence = Array.isArray(proposal?.evidence) ? proposal.evidence : [];
  return evidence.length ? evidence.map((ev) => `<span title="${escapeHtml(ev.label || '')}">${escapeHtml(ev.kind || 'evidence')}</span>`).join('')
    : '<span>No evidence collected yet.</span>';
}

function markdownPreview(text) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.map((line) => {
    if (line.startsWith('# ')) return `<h3>${escapeHtml(line.slice(2))}</h3>`;
    if (line.startsWith('## ')) return `<h4>${escapeHtml(line.slice(3))}</h4>`;
    if (/^\s*[-*]\s+/.test(line)) return `<p class="md-bullet">${escapeHtml(line.replace(/^\s*[-*]\s+/, ''))}</p>`;
    if (!line.trim()) return '<br />';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}
