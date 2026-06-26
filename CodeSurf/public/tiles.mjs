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

const STATUSES = new Set(['idle', 'working', 'blocked', 'done', 'error', 'offline']);

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
    type: 'status', label: 'Status', defaultSize: { w: 260, h: 180 }, capabilities: [],
    renderBody: () => '<p class="muted">Status tile — workspace task/claim overview (M4).</p>',
  });
  reg.register({
    type: 'browser', label: 'Browser', defaultSize: { w: 320, h: 240 }, capabilities: [],
    renderBody: () => '<p class="muted">Browser tile — local URL + screenshots (later milestone).</p>',
  });
  reg.register({
    type: 'document', label: 'Document', defaultSize: { w: 300, h: 220 }, capabilities: [],
    renderBody: (t) => t.data.text ? `<pre>${escapeHtml(t.data.text)}</pre>`
      : '<p class="muted">Document tile — markdown / repo file (later milestone).</p>',
  });
  return reg;
}
