// CodeSurf infinite canvas (M2) — zero-dependency vanilla module.
//
// Coordinate model: viewport = { x, y, zoom }. #world is CSS-transformed
//   translate(x, y) scale(zoom)
// so a tile placed at world (tile.x, tile.y) renders at screen
//   (tile.x*zoom + x, tile.y*zoom + y).
// Links are drawn in world units inside a transformed (overflow-visible) SVG.

import {
  createDefaultRegistry, normalizeTile, serializeTile, deserializeTile,
  safeRender, focusOrder, escapeHtml,
} from './tiles.mjs';

const registry = createDefaultRegistry();

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const world = $('#world');
const linksSvg = $('#links');
const linkKindSelect = $('#link-kind');
const linkDirectedInput = $('#link-directed');
const statusEl = $('#status');
const zoomStatusEl = $('#zoom-status');
const wsSelect = $('#workspace-select');
const minimap = $('#minimap');
const emptyState = $('#empty-state');
const toastRegion = $('#toast-region');
const activityFeed = $('#activity-feed');
const activityList = $('#activity-list');
const activityRefresh = $('#activity-refresh');
const attentionList = $('#attention-list');
const attentionRefresh = $('#attention-refresh');
const EMPTY_GUIDE_DISMISSED_KEY = 'codesurf:emptyGuideDismissed';

// ---- app state ----------------------------------------------------------
const app = {
  workspaceId: null,
  layout: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, tiles: [], links: [] },
  selectedId: null,
};
const vp = () => app.layout.viewport;
const tiles = () => app.layout.tiles;
const links = () => app.layout.links;
const tileById = (id) => tiles().find((t) => t.id === id);
const closestTileEl = (target) => target instanceof Element ? target.closest('.tile') : null;

// ---- API ----------------------------------------------------------------
class CodeSurfApiError extends Error {
  constructor(message, { code = '', status = 0, details = null } = {}) {
    super(message);
    this.name = 'CodeSurfApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new CodeSurfApiError(data?.error?.message || res.statusText, {
    code: data?.error?.code || '',
    status: res.status,
    details: data?.error?.details || null,
  });
  return data;
}

// ---- coordinate transforms ----------------------------------------------
function screenToWorld(sx, sy) {
  const { x, y, zoom } = vp();
  const rect = canvas.getBoundingClientRect();
  return { wx: (sx - rect.left - x) / zoom, wy: (sy - rect.top - y) / zoom };
}
function applyViewport() {
  const { x, y, zoom } = vp();
  world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  updateZoomStatus();
  renderMinimap();
}

function updateZoomStatus() {
  if (!zoomStatusEl) return;
  zoomStatusEl.textContent = Math.round(vp().zoom * 100) + '%';
  zoomStatusEl.title = 'Current zoom level';
}

// ---- rendering ----------------------------------------------------------
function renderAll() {
  // remove existing tile nodes (keep the persistent <svg id="links">)
  world.querySelectorAll('.tile').forEach((n) => n.remove());
  agentHandoffTiles.clear();
  agentTimelineTiles.clear();
  for (const t of tiles()) {
    // element-level crash isolation: a broken tile must not abort the whole render
    try { world.appendChild(makeTileEl(t)); }
    catch (err) { world.appendChild(errorTileEl(t, err)); }
  }
  renderLinks();
  applyViewport();
  updateEmptyState();
}

function makeTileEl(t) {
  const def = registry.get(t.type);
  const el = document.createElement('div');
  el.className = 'tile'
    + (t.id === app.selectedId ? ' selected' : '')
    + (t.minimized ? ' minimized' : '')
    + (t.pinned ? ' pinned' : '')
    + (def.unknown ? ' unknown' : '');
  el.dataset.id = t.id;
  el.tabIndex = 0; // focusable for keyboard traversal
  el.style.left = t.x + 'px';
  el.style.top = t.y + 'px';
  el.style.width = t.w + 'px';
  el.style.height = t.minimized ? 'auto' : t.h + 'px';

  const body = safeRender(def, t);
  el.innerHTML = `
    <div class="head" title="Drag this header to move the Tile" data-tip="Drag header to move">
      <span class="dot status-${escapeHtml(t.status || 'idle')}" title="${escapeHtml(t.status || 'idle')}"></span>
      <span class="type">${escapeHtml(def.label)}</span>
      <span class="title">${escapeHtml(t.title || def.label)}</span>
      <button class="btn context" title="Objective, skills, and context" aria-label="Open Objective and Context">◫</button>
      <button class="btn pin" title="Pin (lock position)" aria-label="${t.pinned ? 'Unpin Tile' : 'Pin Tile'}">${t.pinned ? '📌' : '📍'}</button>
      <button class="btn min" title="${t.minimized ? 'Expand' : 'Minimize'}" aria-label="${t.minimized ? 'Expand Tile' : 'Minimize Tile'}">${t.minimized ? '▢' : '▁'}</button>
      <button class="btn close" title="Delete tile" aria-label="Delete Tile">×</button>
    </div>
    <div class="body${body.ok ? '' : ' has-error'}">${body.html}</div>
    <div class="port" title="Drag to another Tile to create a link" data-tip="Drag to connect" role="button" aria-label="Drag to another Tile to create a link"></div>
    <div class="resize" title="Resize Tile" aria-label="Resize Tile"></div>`;
  if (def.type === 'terminal' || def.type === 'agent') wireTerminal(el, t);
  if (def.type === 'agent') {
    wireAgentHandoff(el, t);
    wireAgentActions(el, t);
    wireAgentTimeline(el, t);
  }
  if (def.type === 'chat') wireChat(el, t);
  if (def.type === 'status') wireStatusTile(el, t);
  if (def.type === 'git') wireGitTile(el, t);
  if (def.type === 'memory') wireMemoryTile(el, t);
  if (def.type === 'browser') wireBrowserTile(el, t);
  if (def.type === 'document') wireDocumentTile(el, t);
  return el;
}

function errorTileEl(t, err) {
  const el = document.createElement('div');
  el.className = 'tile unknown';
  el.dataset.id = t.id;
  el.style.left = (t.x || 0) + 'px';
  el.style.top = (t.y || 0) + 'px';
  el.style.width = (t.w || 220) + 'px';
  el.innerHTML = `
    <div class="head"><span class="type">error</span><span class="title">${escapeHtml(t.id)}</span>
      <button class="btn close" title="Delete tile">×</button></div>
    <div class="body has-error"><div class="tile-error">⚠ ${escapeHtml(err && err.message || String(err))}</div></div>
    <div class="resize"></div>`;
  return el;
}

function portPoint(t, side) {
  const cy = t.y + t.h / 2;
  return side === 'out' ? { x: t.x + t.w, y: cy } : { x: t.x, y: cy };
}

function linkPath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function linkKindLabel(kind) {
  return ({
    controls: 'controls',
    reports_to: 'reports to',
    reviews: 'reviews',
    handoff: 'handoff',
    broadcast_group: 'broadcast',
  })[kind] || 'link';
}

function currentLinkOptions() {
  return {
    kind: linkKindSelect?.value || '',
    directed: linkDirectedInput ? linkDirectedInput.checked : true,
  };
}

function setLinkSync(link, status) {
  if (!link) return;
  link.syncStatus = status;
  renderLinks();
  scheduleSave();
}

function linkByEndpoints(source, target) {
  return links().find((l) => l.source === source && l.target === target);
}

function renderLinks() {
  // keep only the temp-drag path, rebuild persistent links
  linksSvg.querySelectorAll('path:not(.temp), text.link-label').forEach((n) => n.remove());
  if (!linksSvg.querySelector('#arrowhead')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <polygon points="0,0 10,5 0,10"></polygon>
    </marker>`;
    linksSvg.prepend(defs);
  }
  for (const l of links()) {
    const s = tileById(l.source), d = tileById(l.target);
    if (!s || !d) continue;
    const a = portPoint(s, 'out');
    const b = portPoint(d, 'in');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', linkPath(a, b));
    p.classList.add('semantic-link');
    if (l.kind) p.classList.add('kind-' + l.kind);
    if (l.syncStatus === 'sync_failed') p.classList.add('sync-failed');
    if (l.directed !== false) p.setAttribute('marker-end', 'url(#arrowhead)');
    p.dataset.linkId = l.id;
    linksSvg.appendChild(p);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.classList.add('link-label');
    if (l.syncStatus === 'sync_failed') label.classList.add('sync-failed');
    label.setAttribute('x', String((a.x + b.x) / 2));
    label.setAttribute('y', String((a.y + b.y) / 2 - 8));
    label.textContent = `${linkKindLabel(l.kind)}${l.directed === false ? ' ↔' : ' →'}${l.syncStatus === 'sync_failed' ? ' · sync failed' : ''}`;
    linksSvg.appendChild(label);
  }
}

function renderMinimap() {
  const ctx = minimap.getContext('2d');
  const W = minimap.width, H = minimap.height;
  ctx.clearRect(0, 0, W, H);
  const ts = tiles();
  if (ts.length === 0) return;
  // world bounding box across tiles
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of ts) {
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.w); maxY = Math.max(maxY, t.y + t.h);
  }
  // include current viewport rect in the bbox so it stays visible
  const view = visibleWorldRect();
  minX = Math.min(minX, view.x); minY = Math.min(minY, view.y);
  maxX = Math.max(maxX, view.x + view.w); maxY = Math.max(maxY, view.y + view.h);
  const pad = 40;
  const bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
  const scale = Math.min(W / bw, H / bh);
  const ox = -(minX - pad) * scale, oy = -(minY - pad) * scale;
  ctx.fillStyle = '#3a4660';
  for (const t of ts) ctx.fillRect(ox + t.x * scale, oy + t.y * scale, Math.max(2, t.w * scale), Math.max(2, t.h * scale));
  ctx.strokeStyle = '#4f9cff';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + view.x * scale, oy + view.y * scale, view.w * scale, view.h * scale);
  minimap._map = { ox, oy, scale }; // for click-to-recenter
}

function visibleWorldRect() {
  const r = canvas.getBoundingClientRect();
  const tl = screenToWorld(r.left, r.top);
  const { zoom } = vp();
  return { x: tl.wx, y: tl.wy, w: r.width / zoom, h: r.height / zoom };
}

// ---- tile element fast-update (during drag/resize) ----------------------
function syncTileEl(t) {
  const el = world.querySelector(`.tile[data-id="${t.id}"]`);
  if (!el) return;
  el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
  el.style.width = t.w + 'px'; el.style.height = t.h + 'px';
}

// ---- selection ----------------------------------------------------------
function select(id) {
  const changed = app.selectedId !== id;
  app.selectedId = id;
  world.querySelectorAll('.tile').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  if (id && changed) raiseTile(id); // only raise on a real selection change (keeps input focus stable)
}

// bring a tile to the front (DOM order = paint order; #links svg stays first/behind)
function raiseTile(id) {
  const el = world.querySelector(`.tile[data-id="${id}"]`);
  if (el && el !== world.lastElementChild) world.appendChild(el);
}

// ---- mutations ----------------------------------------------------------
function addTile(wx, wy, type = currentTileType()) {
  const def = registry.get(type);
  const spot = freeSpot(Math.round(wx), Math.round(wy)); // avoid spawning exactly on top of another tile
  const t = normalizeTile({
    type, title: def.label, x: spot.x, y: spot.y,
    w: def.defaultSize.w, h: def.defaultSize.h,
  }, registry);
  tiles().push(t);
  world.appendChild(makeTileEl(t));
  select(t.id);
  renderMinimap();
  updateEmptyState();
  scheduleSave();
  return t;
}

// nudge down-right until the spot isn't (nearly) coincident with an existing tile
function freeSpot(x, y) {
  let nx = x, ny = y;
  while (tiles().some((t) => Math.abs(t.x - nx) < 12 && Math.abs(t.y - ny) < 12)) { nx += 28; ny += 28; }
  return { x: nx, y: ny };
}

function currentTileType() {
  return $('#tile-type').value || 'note';
}

function toggleMinimize(id) {
  const t = tileById(id); if (!t) return;
  t.minimized = !t.minimized;
  replaceTileEl(t); scheduleSave();
}
function togglePin(id) {
  const t = tileById(id); if (!t) return;
  t.pinned = !t.pinned;
  replaceTileEl(t); scheduleSave();
}
function replaceTileEl(t) {
  world.querySelector(`.tile[data-id="${t.id}"]`)?.remove();
  world.appendChild(makeTileEl(t));
  renderLinks();
}

function deleteTile(id) {
  const tile = tileById(id);
  if (!tile) return;
  const removedLinks = links().filter((l) => l.source === id || l.target === id);
  const deleted = { tile: structuredClone(tile), links: structuredClone(removedLinks) };
  app.layout.tiles = tiles().filter((t) => t.id !== id);
  app.layout.links = links().filter((l) => l.source !== id && l.target !== id);
  world.querySelector(`.tile[data-id="${id}"]`)?.remove();
  if (app.selectedId === id) app.selectedId = null;
  renderLinks(); renderMinimap(); updateEmptyState(); scheduleSave();
  for (const l of removedLinks) contexMirrorLink('DELETE', l);
  closeStream(id);
  disposeTerminalUI(id);
  chatTiles.delete(id);
  agentHandoffTiles.delete(id);
  pendingAttention.delete(id);
  agentTimelineTiles.delete(id);
  statusTiles.delete(id);
  api('POST', `/api/terminals/${id}/stop`).catch(() => {}); // stop any process the tile owned
  offerUndoDelete(deleted);
}

function addLink(source, target, opts = {}) {
  if (source === target) {
    showToast('A Tile cannot connect to itself.', { tone: 'warning' });
    return false;
  }
  if (links().some((l) => l.source === source && l.target === target)) {
    showToast('Those Tiles are already connected.', { tone: 'warning' });
    return false;
  }
  const directed = opts.directed !== false;
  const kind = opts.kind || '';
  const link = {
    id: 'link_' + crypto.randomUUID().replace(/-/g, ''),
    source,
    target,
    directed,
    ...(kind ? { kind } : {}),
    syncStatus: contexConnected ? 'syncing' : 'local',
  };
  links().push(link);
  renderLinks(); scheduleSave();
  contexMirrorLink('POST', link); // mirror to Contex peer graph (best-effort)
  showToast(contexConnected ? `${linkKindLabel(kind)} link syncing to Contex…` : `${linkKindLabel(kind)} link created locally.`);
  return true;
}

function createDemoLayout() {
  if (!app.workspaceId) return;
  const r = visibleWorldRect();
  const startX = Math.round(r.x + r.w / 2 - 480);
  const startY = Math.round(r.y + r.h / 2 - 130);
  const brief = addTile(startX, startY, 'note');
  brief.title = 'Project brief';
  brief.data = { note: 'Write the goal, constraints, and open questions here. This demo is local and does not run commands.' };
  const plan = addTile(startX + 300, startY, 'document');
  plan.title = 'Plan';
  plan.data = { text: '# Safe demo plan\n\n- Break work into Tiles\n- Link related context\n- Add agents or terminals only when needed' };
  const chat = addTile(startX + 650, startY + 30, 'chat');
  chat.title = 'Team chat';
  replaceTileEl(brief);
  replaceTileEl(plan);
  replaceTileEl(chat);
  addLink(brief.id, plan.id);
  addLink(plan.id, chat.id);
  select(brief.id);
  centerOn(plan.x + plan.w / 2, plan.y + plan.h / 2);
  scheduleSave();
  showToast('Safe demo layout created.');
}

let toastTimer = null;
let undoDelete = null;
function clearToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  toastRegion.replaceChildren();
}
function showToast(message, { actionLabel, action, tone = '' } = {}) {
  clearToast();
  const toast = document.createElement('div');
  toast.className = 'toast' + (tone ? ' ' + tone : '');
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  if (actionLabel && typeof action === 'function') {
    const button = document.createElement('button');
    button.id = 'toast-action';
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    toast.appendChild(button);
  }
  toastRegion.appendChild(toast);
  toastTimer = setTimeout(() => { toastRegion.replaceChildren(); toastTimer = null; }, 5000);
}
function offerUndoDelete(deleted) {
  undoDelete = deleted;
  showToast(`Deleted ${deleted.tile.title || 'Tile'}.`, {
    actionLabel: 'Undo',
    action: () => restoreDeletedTile(),
  });
}
function restoreDeletedTile() {
  const deleted = undoDelete;
  undoDelete = null;
  if (!deleted || tileById(deleted.tile.id)) return;
  tiles().push(deleted.tile);
  const restoredLinks = deleted.links.filter((link) =>
    tileById(link.source) && tileById(link.target) && !links().some((current) => current.id === link.id));
  app.layout.links.push(...restoredLinks);
  renderAll();
  select(deleted.tile.id);
  scheduleSave();
  for (const link of restoredLinks) contexMirrorLink('POST', link);
  showToast('Tile restored.');
}

// ---- autosave -----------------------------------------------------------
let saveTimer = null;
let dirty = false;
function scheduleSave() {
  if (!app.workspaceId) return;
  dirty = true;
  setStatus('⏳ Saving…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
function layoutPayload() {
  return { ...app.layout, tiles: app.layout.tiles.map(serializeTile) };
}
async function saveNow() {
  if (!app.workspaceId) return;
  try {
    const layout = layoutPayload();
    await api('PUT', `/api/workspaces/${app.workspaceId}/layout`, { layout });
    dirty = false;
    const t = new Date();
    setStatus(`✓ Saved ${t.toLocaleTimeString()}`, 'saved');
  } catch (e) {
    setStatus('⚠ Save failed: ' + e.message, 'error');
  }
}
function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- interactions: pan / zoom ------------------------------------------
let drag = null; // active gesture descriptor

canvas.addEventListener('mousedown', (e) => {
  const tileEl = closestTileEl(e.target);
  if (e.target.classList.contains('port')) {
    return startLinkDrag(tileEl.dataset.id, e);
  }
  if (e.target.classList.contains('resize')) {
    return startResize(tileEl.dataset.id, e);
  }
  if (e.target.classList.contains('close')) {
    return deleteTile(tileEl.dataset.id);
  }
  if (e.target.classList.contains('context')) {
    return openContextDialog(tileEl.dataset.id);
  }
  if (e.target.classList.contains('min')) {
    return toggleMinimize(tileEl.dataset.id);
  }
  if (e.target.classList.contains('pin')) {
    return togglePin(tileEl.dataset.id);
  }
  if (tileEl && e.target.closest('.head')) {
    select(tileEl.dataset.id);
    if (tileById(tileEl.dataset.id)?.pinned) return; // pinned tiles don't drag
    return startTileDrag(tileEl.dataset.id, e);
  }
  if (tileEl) { select(tileEl.dataset.id); return; } // body click → allow text selection
  // empty canvas → pan + clear selection
  e.preventDefault();
  select(null);
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: vp().x, oy: vp().y };
  canvas.classList.add('panning', 'dragging');
});

canvas.addEventListener('click', (e) => {
  if (e.detail !== 0) return; // mouse actions are handled on mousedown; this path is keyboard activation
  const tileEl = closestTileEl(e.target);
  if (!tileEl) return;
  if (e.target.classList.contains('close')) {
    e.preventDefault();
    deleteTile(tileEl.dataset.id);
  } else if (e.target.classList.contains('context')) {
    e.preventDefault();
    openContextDialog(tileEl.dataset.id);
  } else if (e.target.classList.contains('min')) {
    e.preventDefault();
    toggleMinimize(tileEl.dataset.id);
  } else if (e.target.classList.contains('pin')) {
    e.preventDefault();
    togglePin(tileEl.dataset.id);
  }
});

canvas.addEventListener('dblclick', (e) => {
  if (closestTileEl(e.target)) return;
  const { wx, wy } = screenToWorld(e.clientX, e.clientY);
  addTile(wx - 110, wy - 70);
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    vp().x = drag.ox + (e.clientX - drag.sx);
    vp().y = drag.oy + (e.clientY - drag.sy);
    applyViewport();
  } else if (drag.kind === 'tile') {
    const t = tileById(drag.id);
    t.x = Math.round(drag.tx + (e.clientX - drag.sx) / vp().zoom);
    t.y = Math.round(drag.ty + (e.clientY - drag.sy) / vp().zoom);
    syncTileEl(t); renderLinks(); renderMinimap();
  } else if (drag.kind === 'resize') {
    const t = tileById(drag.id);
    t.w = Math.max(120, Math.round(drag.tw + (e.clientX - drag.sx) / vp().zoom));
    t.h = Math.max(80, Math.round(drag.th + (e.clientY - drag.sy) / vp().zoom));
    syncTileEl(t); renderLinks(); renderMinimap();
  } else if (drag.kind === 'link') {
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    drag.tempPath.setAttribute('d', linkPath(portPoint(tileById(drag.source), 'out'), { x: wx, y: wy }));
  }
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  if (drag.kind === 'link') {
    const overTile = closestTileEl(e.target);
    if (overTile) addLink(drag.source, overTile.dataset.id, currentLinkOptions());
    else showToast('Drop the port on another Tile to create a link.', { tone: 'warning' });
    drag.tempPath.remove();
  } else if (drag.kind === 'tile' || drag.kind === 'resize') {
    scheduleSave();
  }
  canvas.classList.remove('panning', 'dragging');
  drag = null;
});

// suppress native text-selection while a drag gesture is active
function beginDrag(e) {
  e.preventDefault();
  canvas.classList.add('dragging');
}
function startTileDrag(id, e) {
  beginDrag(e);
  const t = tileById(id);
  drag = { kind: 'tile', id, sx: e.clientX, sy: e.clientY, tx: t.x, ty: t.y };
}
function startResize(id, e) {
  beginDrag(e);
  const t = tileById(id);
  drag = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, tw: t.w, th: t.h };
}
function startLinkDrag(sourceId, e) {
  beginDrag(e);
  const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.classList.add('temp');
  linksSvg.appendChild(tempPath);
  drag = { kind: 'link', source: sourceId, tempPath };
  e.stopPropagation();
}

// zoom toward cursor
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { wx, wy } = screenToWorld(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const zoom = clamp(vp().zoom * factor, 0.1, 4);
  const rect = canvas.getBoundingClientRect();
  vp().zoom = zoom;
  // keep the world point under the cursor fixed
  vp().x = (e.clientX - rect.left) - wx * zoom;
  vp().y = (e.clientY - rect.top) - wy * zoom;
  applyViewport();
  scheduleSave();
}, { passive: false });

// ---- minimap click-to-recenter -----------------------------------------
minimap.addEventListener('click', (e) => {
  const m = minimap._map; if (!m) return;
  const r = minimap.getBoundingClientRect();
  const wx = (e.clientX - r.left - m.ox) / m.scale;
  const wy = (e.clientY - r.top - m.oy) / m.scale;
  centerOn(wx, wy);
});

function centerOn(wx, wy) {
  const rect = canvas.getBoundingClientRect();
  vp().x = rect.width / 2 - wx * vp().zoom;
  vp().y = rect.height / 2 - wy * vp().zoom;
  applyViewport(); scheduleSave();
}

// ---- zoom to fit --------------------------------------------------------
function zoomToFit() {
  const ts = tiles();
  const rect = canvas.getBoundingClientRect();
  if (ts.length === 0) { vp().x = rect.width / 2; vp().y = rect.height / 2; vp().zoom = 1; applyViewport(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of ts) {
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.w); maxY = Math.max(maxY, t.y + t.h);
  }
  const pad = 60;
  const zoom = clamp(Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2)), 0.1, 2);
  vp().zoom = zoom;
  vp().x = (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom;
  vp().y = (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom;
  applyViewport(); scheduleSave();
}

// ---- keyboard -----------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (drag?.kind === 'link') { drag.tempPath.remove(); drag = null; return; }
    if (helpDialog.open) { helpDialog.close(); return; }
    if (newDialog.open) { newDialog.close(); return; }
    if (contextDialog.open) { contextDialog.close(); return; }
  }
  if (isTypingTarget(e.target)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedId) { e.preventDefault(); deleteTile(app.selectedId); }
  else if (e.key.toLowerCase() === 'n') { e.preventDefault(); addTileAtViewportCenter(true); }
  else if (e.key.toLowerCase() === 'f') { e.preventDefault(); zoomToFit(); }
  else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  else if (e.key === '?') { e.preventDefault(); openHelpDialog(); }
  else if (e.key === 'Tab') { e.preventDefault(); focusNextTile(e.shiftKey ? -1 : 1); }
});

function isTypingTarget(target) {
  return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// Tab / Shift-Tab walk tiles in reading order (pinned first), keeping the
// focused tile centered and selected — the accessible traversal the plan calls for.
function focusNextTile(dir) {
  const order = focusOrder(tiles());
  if (order.length === 0) return;
  const cur = order.indexOf(app.selectedId);
  const next = order[(cur + dir + order.length) % order.length];
  select(next);
  const t = tileById(next);
  if (t) { centerOn(t.x + t.w / 2, t.y + t.h / 2); world.querySelector(`.tile[data-id="${next}"]`)?.focus(); }
}

// ---- toolbar wiring -----------------------------------------------------
// populate the tile-type picker from the registry (canvas core stays type-agnostic)
const typeSelect = $('#tile-type');
for (const def of registry.list()) {
  const opt = document.createElement('option');
  opt.value = def.type; opt.textContent = def.label;
  typeSelect.appendChild(opt);
}

$('#add-tile').addEventListener('click', () => {
  addTileAtViewportCenter(true);
});
$('#empty-add-tile').addEventListener('click', () => {
  addTileAtViewportCenter(true);
});
$('#empty-demo-layout').addEventListener('click', () => {
  createDemoLayout();
});
$('#empty-dismiss').addEventListener('click', () => {
  setEmptyGuideDismissed(true);
});
$('#fit').addEventListener('click', zoomToFit);
$('#reset-zoom').addEventListener('click', resetZoom);
function resetZoom() {
  vp().zoom = 1; applyViewport(); scheduleSave();
}
function addTileAtViewportCenter(focus = false) {
  const r = visibleWorldRect();
  const tile = addTile(r.x + r.w / 2 - 110, r.y + r.h / 2 - 70);
  if (focus) world.querySelector(`.tile[data-id="${tile.id}"]`)?.focus();
  return tile;
}

async function runtimeCodexSpec() {
  const info = await api('GET', '/api/agent-runtimes/codex');
  return {
    command: info.command || 'node',
    args: Array.isArray(info.args) ? info.args : [info.script || 'CodeSurf/scripts/agent-runtime-codex.mjs'],
  };
}

// ---- workspace lifecycle ------------------------------------------------
async function loadWorkspaces(selectId) {
  const { workspaces } = await api('GET', '/api/workspaces');
  wsSelect.innerHTML = '';
  for (const w of workspaces) {
    const opt = document.createElement('option');
    opt.value = w.id; opt.textContent = w.name;
    wsSelect.appendChild(opt);
  }
  if (workspaces.length === 0) { openNewDialog(); return; }
  const target = selectId && workspaces.some((w) => w.id === selectId) ? selectId : workspaces[0].id;
  wsSelect.value = target;
  await openWorkspace(target);
}

async function openWorkspace(id) {
  if (app.workspaceId && app.workspaceId !== id) {
    try { await api('POST', `/api/workspaces/${app.workspaceId}/close`); } catch { /* ignore */ }
  }
  const { meta, layout, recovered } = await api('GET', `/api/workspaces/${id}`);
  app.workspaceId = meta.id;
  app.repositoryPath = meta.repositoryPath; // terminals run here
  // normalize every tile through the registry (handles unknown types + defaults)
  app.layout = { ...layout, tiles: (layout.tiles || []).map((raw) => deserializeTile(raw, registry)) };
  app.selectedId = null;
  renderAll();
  if (tiles().length) zoomToFit();
  setStatus(recovered ? '⚠ Recovered from backup' : `✓ Opened ${meta.name}`, recovered ? 'recovered' : 'saved');
}

wsSelect.addEventListener('change', () => openWorkspace(wsSelect.value));

function updateEmptyState() {
  emptyState.hidden = !app.workspaceId || tiles().length > 0 || isEmptyGuideDismissed();
}

function isEmptyGuideDismissed() {
  try { return localStorage.getItem(EMPTY_GUIDE_DISMISSED_KEY) === '1'; }
  catch { return false; }
}

function setEmptyGuideDismissed(dismissed) {
  try {
    if (dismissed) localStorage.setItem(EMPTY_GUIDE_DISMISSED_KEY, '1');
    else localStorage.removeItem(EMPTY_GUIDE_DISMISSED_KEY);
  } catch { /* localStorage may be blocked */ }
  updateEmptyState();
}

// ---- new-workspace dialog ----------------------------------------------
const newDialog = $('#new-dialog');
const newWorkspaceForm = $('#new-workspace-form');
const newWorkspaceName = $('#nw-name');
const newWorkspaceRepo = $('#nw-repo');
const newWorkspaceError = $('#nw-error');
const newWorkspaceCreate = $('#nw-create');
const newWorkspaceCancel = $('#nw-cancel');
const newWorkspaceBrowse = $('#nw-browse');
const newWorkspacePathExample = $('#nw-path-example-value');
const newWorkspaceModeNote = $('#nw-mode-note');
const helpDialog = $('#help-dialog');
const helpButton = $('#help');
const agentDialog = $('#agent-dialog');
const agentForm = $('#agent-form');
const agentName = $('#agent-name');
const agentRuntime = $('#agent-runtime');
const agentRole = $('#agent-role');
const agentModel = $('#agent-model');
const agentCwd = $('#agent-cwd');
const agentCapabilities = $('#agent-capabilities');
const agentCommand = $('#agent-command');
const agentSystemPrompt = $('#agent-system-prompt');
const agentAutoStart = $('#agent-auto-start');
const agentError = $('#agent-error');
const workflowDialog = $('#workflow-dialog');
const workflowForm = $('#workflow-form');
const workflowPreset = $('#workflow-preset');
const workflowAutoStart = $('#workflow-auto-start');
const workflowError = $('#workflow-error');
const contextDialog = $('#context-dialog');
const contextTitle = $('#context-title');
const contextSubtitle = $('#ctx-subtitle');
const contextStatus = $('#ctx-status');
const contextObjective = $('#ctx-objective');
const contextSkillsList = $('#ctx-skills-list');
const contextAttachmentsList = $('#ctx-attachments-list');
const contextSkillKey = $('#ctx-skill-key');
const contextSkillEnabled = $('#ctx-skill-enabled');
const contextAttachmentKind = $('#ctx-attachment-kind');
const contextAttachmentLabel = $('#ctx-attachment-label');
const contextAttachmentUri = $('#ctx-attachment-uri');
let dialogReturnFocus = null;
let creatingWorkspace = false;
let activeContextTileId = null;
let creatingAgent = false;
let creatingWorkflow = false;

function platformPathExample() {
  return navigator.platform.toLowerCase().startsWith('win')
    ? 'C:\\Users\\name\\project\\repo'
    : '/Users/name/project/repo';
}
function updateRepositoryPathHelp() {
  const example = platformPathExample();
  newWorkspaceRepo.placeholder = example;
  newWorkspacePathExample.textContent = example;
  const chooser = globalThis.codesurf?.chooseRepositoryFolder;
  if (typeof chooser === 'function') {
    newWorkspaceBrowse.disabled = false;
    newWorkspaceBrowse.title = 'Choose an existing local folder.';
    newWorkspaceModeNote.textContent = 'Desktop mode: choose a folder or paste an absolute path.';
  } else {
    newWorkspaceBrowse.disabled = true;
    newWorkspaceBrowse.title = 'Folder selection is available in the desktop shell. In browser mode, paste the absolute path manually.';
    newWorkspaceModeNote.textContent = 'Browser mode: paste the absolute path manually. Folder selection is available in the desktop shell.';
  }
}
function setNewWorkspaceError(message = '', field = '') {
  newWorkspaceError.textContent = message;
  newWorkspaceName.setAttribute('aria-invalid', message && field === 'name' ? 'true' : 'false');
  newWorkspaceRepo.setAttribute('aria-invalid', message && field === 'repo' ? 'true' : 'false');
}
function setNewWorkspaceSubmitting(submitting) {
  creatingWorkspace = submitting;
  newWorkspaceForm.setAttribute('aria-busy', submitting ? 'true' : 'false');
  newWorkspaceCreate.disabled = submitting;
  newWorkspaceCreate.textContent = submitting ? 'Creating…' : 'Create';
  newWorkspaceCancel.disabled = submitting;
  newWorkspaceCancel.title = submitting ? 'Please wait while the workspace is created.' : '';
}
function newWorkspaceErrorMessage(error) {
  if (error?.code === 'CODESURF_REPO_INVALID') {
    return 'Repository folder not found. Paste an absolute path to an existing local folder.';
  }
  if (error?.code === 'CODESURF_BAD_REQUEST') {
    return error.message || 'Check the workspace name and repository path.';
  }
  return error?.message || 'Could not create the workspace. Please try again.';
}
function openNewDialog({ reset = true } = {}) {
  dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (reset) {
    newWorkspaceForm.reset();
    setNewWorkspaceError();
  }
  updateRepositoryPathHelp();
  if (!newDialog.open) newDialog.showModal();
  queueMicrotask(() => newWorkspaceName.focus());
}

$('#new-workspace').addEventListener('click', () => openNewDialog());
$('#nw-cancel').addEventListener('click', () => newDialog.close());
newWorkspaceBrowse.addEventListener('click', async () => {
  const chooser = globalThis.codesurf?.chooseRepositoryFolder;
  if (typeof chooser !== 'function') return;
  try {
    const folder = await chooser();
    if (folder) {
      newWorkspaceRepo.value = folder;
      setNewWorkspaceError();
      newWorkspaceRepo.focus();
    }
  } catch (e) {
    setNewWorkspaceError(e.message || 'Could not choose a folder.', 'repo');
  }
});
newDialog.addEventListener('close', () => {
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
});
newWorkspaceForm.addEventListener('input', () => setNewWorkspaceError());
newWorkspaceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (creatingWorkspace) return;
  const name = newWorkspaceName.value.trim();
  const repositoryPath = newWorkspaceRepo.value.trim();
  if (!name) {
    setNewWorkspaceError('Enter a workspace name.', 'name');
    newWorkspaceName.focus();
    return;
  }
  if (!repositoryPath) {
    setNewWorkspaceError('Enter an absolute path to an existing local folder.', 'repo');
    newWorkspaceRepo.focus();
    return;
  }
  setNewWorkspaceSubmitting(true);
  setNewWorkspaceError();
  try {
    const meta = await api('POST', '/api/workspaces', { name, repositoryPath });
    newDialog.close();
    newWorkspaceForm.reset();
    await loadWorkspaces(meta.id);
  } catch (e) {
    setNewWorkspaceError(newWorkspaceErrorMessage(e), 'repo');
    newWorkspaceRepo.focus();
  } finally {
    setNewWorkspaceSubmitting(false);
  }
});

function openHelpDialog() {
  dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!helpDialog.open) helpDialog.showModal();
  queueMicrotask(() => $('#help-close').focus());
}
helpButton.addEventListener('click', openHelpDialog);
$('#help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('close', () => {
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
});

// ---- create agent dialog (Agent Platform Phase 4) -----------------------
function parseCapabilities(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function roleTitle(role) {
  return String(role || 'worker').replace(/(^|[-_\s])\w/g, (m) => m.toUpperCase()).replace(/[-_]/g, ' ');
}

async function refreshAgentRuntimeDefaults() {
  agentCwd.value = app.repositoryPath || '';
  if (agentRuntime.value === 'codex') {
    try {
      const spec = await runtimeCodexSpec();
      agentCommand.value = [spec.command, ...spec.args].join(' ');
    } catch {
      agentCommand.value = 'node CodeSurf/scripts/agent-runtime-codex.mjs';
    }
  } else if (!agentCommand.value.trim()) {
    agentCommand.value = agentRuntime.value === 'node' ? 'node agent.js' : '';
  }
}

async function defaultCodexCommandLine() {
  try {
    const spec = await runtimeCodexSpec();
    return [spec.command, ...spec.args].join(' ');
  } catch {
    return 'node CodeSurf/scripts/agent-runtime-codex.mjs';
  }
}

function defaultAgentSystemPrompt(role) {
  return `You are a CodeSurf ${role} agent. Help the team by reporting status clearly and using Contex messages to coordinate.`;
}

function createConfiguredAgentTile({ x, y, name, role = 'worker', runtime = 'codex', model = '', commandLine, capabilities, systemPrompt, cwd, autoStart = false }) {
  const t = addTile(x, y, 'agent');
  const command = String(commandLine || '').trim();
  const parts = command.split(/\s+/).filter(Boolean);
  const caps = Array.isArray(capabilities) && capabilities.length ? capabilities : ['chat', 'code_edit', 'terminal_input'];
  const profile = {
    runtime,
    role,
    model: model || undefined,
    system_prompt: systemPrompt || defaultAgentSystemPrompt(role),
    cwd: cwd || app.repositoryPath || undefined,
    display_name: name,
    capabilities: caps,
    auto_start: !!autoStart,
  };
  t.title = name;
  t.data = {
    ...t.data,
    command,
    commandName: parts[0] || '',
    args: parts.slice(1),
    cwd: profile.cwd,
    env: {
      AGENT_ID: t.id,
      AGENT_TILE_ID: t.id,
      AGENT_ROLE: role,
      AGENT_RUNTIME: runtime,
      AGENT_DISPLAY_NAME: name,
      AGENT_MODEL: profile.model || '',
      AGENT_SYSTEM_PROMPT: profile.system_prompt,
      AGENT_CWD: profile.cwd || '',
      AGENT_PROFILE_JSON: JSON.stringify({ ...profile, agent_id: t.id, tile_id: t.id }),
    },
    agentProfile: profile,
    autostart: !!autoStart,
  };
  replaceTileEl(t);
  return t;
}

async function openAgentDialog() {
  dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  agentForm.reset();
  agentName.value = 'Worker Agent';
  agentRole.value = 'worker';
  agentRuntime.value = 'codex';
  agentCapabilities.value = 'chat, code_edit, terminal_input';
  agentSystemPrompt.value = 'You are a CodeSurf agent. Help the team by reporting status clearly and using Contex messages to coordinate.';
  agentAutoStart.checked = true;
  agentError.textContent = '';
  await refreshAgentRuntimeDefaults();
  if (!agentDialog.open) agentDialog.showModal();
  queueMicrotask(() => agentName.focus());
}

async function createAgentFromDialog(event) {
  event.preventDefault();
  if (creatingAgent) return;
  const name = agentName.value.trim() || roleTitle(agentRole.value) + ' Agent';
  const runtime = agentRuntime.value || 'codex';
  const role = agentRole.value || 'worker';
  const commandLine = agentCommand.value.trim();
  if (!commandLine) {
    agentError.textContent = 'Enter a command.';
    agentCommand.focus();
    return;
  }
  creatingAgent = true;
  agentError.textContent = '';
  try {
    const r = visibleWorldRect();
    const t = createConfiguredAgentTile({
      x: r.x + r.w / 2 - 210,
      y: r.y + r.h / 2 - 150,
      name,
      runtime,
      role,
      model: agentModel.value.trim() || undefined,
      commandLine,
      capabilities: parseCapabilities(agentCapabilities.value),
      systemPrompt: agentSystemPrompt.value,
      cwd: agentCwd.value.trim() || app.repositoryPath || undefined,
      autoStart: agentAutoStart.checked,
    });
    select(t.id);
    centerOn(t.x + t.w / 2, t.y + t.h / 2);
    scheduleSave();
    agentDialog.close();
    showToast(`${name} created${agentAutoStart.checked ? ' and starting…' : '.'}`);
  } catch (e) {
    agentError.textContent = e.message || 'Could not create Agent.';
  } finally {
    creatingAgent = false;
  }
}

$('#create-agent').addEventListener('click', () => { openAgentDialog(); });
$('#agent-cancel').addEventListener('click', () => agentDialog.close());
agentRuntime.addEventListener('change', () => { refreshAgentRuntimeDefaults(); });
agentForm.addEventListener('submit', createAgentFromDialog);
agentDialog.addEventListener('close', () => {
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
});

// ---- workflow presets (Agent Platform UI Phase D) ----------------------
const WORKFLOW_PRESETS = {
  'coordinator-worker-reviewer': {
    label: 'Coordinator + Worker + Reviewer',
    agents: [
      { key: 'coordinator', name: 'Coordinator Agent', role: 'coordinator', dx: 0, dy: 0, capabilities: ['chat', 'planning', 'task_routing'] },
      { key: 'worker', name: 'Worker Agent', role: 'worker', dx: 360, dy: 0, capabilities: ['chat', 'code_edit', 'terminal_input'] },
      { key: 'reviewer', name: 'Reviewer Agent', role: 'reviewer', dx: 720, dy: 0, capabilities: ['chat', 'review'] },
    ],
    links: [
      ['coordinator', 'worker', 'controls'],
      ['worker', 'reviewer', 'handoff'],
      ['reviewer', 'coordinator', 'reports_to'],
    ],
  },
  'planner-workers-reviewer': {
    label: 'Planner + 2 Workers + Reviewer',
    agents: [
      { key: 'planner', name: 'Planner Agent', role: 'planner', dx: 0, dy: 90, capabilities: ['chat', 'planning'] },
      { key: 'workerA', name: 'Worker A', role: 'worker', dx: 360, dy: 0, capabilities: ['chat', 'code_edit', 'terminal_input'] },
      { key: 'workerB', name: 'Worker B', role: 'worker', dx: 360, dy: 220, capabilities: ['chat', 'code_edit', 'terminal_input'] },
      { key: 'reviewer', name: 'Reviewer Agent', role: 'reviewer', dx: 720, dy: 90, capabilities: ['chat', 'review'] },
    ],
    links: [
      ['planner', 'workerA', 'controls'],
      ['planner', 'workerB', 'controls'],
      ['workerA', 'reviewer', 'handoff'],
      ['workerB', 'reviewer', 'handoff'],
      ['reviewer', 'planner', 'reports_to'],
    ],
  },
  'human-coordinator-worker-reviewer': {
    label: 'Human Chat + Coordinator + Worker + Reviewer',
    chat: { key: 'human', title: 'Human Chat', dx: 0, dy: 0 },
    agents: [
      { key: 'coordinator', name: 'Coordinator Agent', role: 'coordinator', dx: 340, dy: 0, capabilities: ['chat', 'planning', 'task_routing'] },
      { key: 'worker', name: 'Worker Agent', role: 'worker', dx: 700, dy: 0, capabilities: ['chat', 'code_edit', 'terminal_input'] },
      { key: 'reviewer', name: 'Reviewer Agent', role: 'reviewer', dx: 1060, dy: 0, capabilities: ['chat', 'review'] },
    ],
    links: [
      ['human', 'coordinator', 'reports_to'],
      ['coordinator', 'worker', 'controls'],
      ['worker', 'reviewer', 'handoff'],
      ['reviewer', 'human', 'reports_to'],
    ],
  },
};

async function openWorkflowDialog() {
  dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  workflowForm.reset();
  workflowAutoStart.checked = false;
  workflowError.textContent = '';
  if (!workflowDialog.open) workflowDialog.showModal();
  queueMicrotask(() => workflowPreset.focus());
}

async function createWorkflowFromDialog(event) {
  event.preventDefault();
  if (creatingWorkflow) return;
  const preset = WORKFLOW_PRESETS[workflowPreset.value] || WORKFLOW_PRESETS['coordinator-worker-reviewer'];
  creatingWorkflow = true;
  workflowError.textContent = '';
  try {
    const commandLine = await defaultCodexCommandLine();
    const r = visibleWorldRect();
    const startX = Math.round(r.x + r.w / 2 - 520);
    const startY = Math.round(r.y + r.h / 2 - 170);
    const byKey = {};
    if (preset.chat) {
      const chat = addTile(startX + preset.chat.dx, startY + preset.chat.dy, 'chat');
      chat.title = preset.chat.title;
      replaceTileEl(chat);
      byKey[preset.chat.key] = chat;
    }
    for (const spec of preset.agents) {
      byKey[spec.key] = createConfiguredAgentTile({
        x: startX + spec.dx,
        y: startY + spec.dy,
        name: spec.name,
        role: spec.role,
        commandLine,
        capabilities: spec.capabilities,
        systemPrompt: defaultAgentSystemPrompt(spec.role),
        autoStart: workflowAutoStart.checked,
      });
    }
    for (const [sourceKey, targetKey, kind] of preset.links) {
      const source = byKey[sourceKey];
      const target = byKey[targetKey];
      if (source && target) addLink(source.id, target.id, { directed: true, kind });
    }
    const first = byKey[preset.chat?.key] || byKey[preset.agents[0]?.key];
    if (first) {
      select(first.id);
      centerOn(first.x + first.w / 2, first.y + first.h / 2);
    }
    scheduleSave();
    workflowDialog.close();
    showToast(`${preset.label} created${workflowAutoStart.checked ? ' and starting…' : '. Agents are not auto-started.'}`);
  } catch (e) {
    workflowError.textContent = e.message || 'Could not create workflow.';
  } finally {
    creatingWorkflow = false;
  }
}

$('#create-workflow').addEventListener('click', () => { openWorkflowDialog(); });
$('#workflow-cancel').addEventListener('click', () => workflowDialog.close());
workflowForm.addEventListener('submit', createWorkflowFromDialog);
workflowDialog.addEventListener('close', () => {
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
});

// ---- tile context dialog (Phase 7: objective / skills / attachments) ----
function setContextStatus(message, cls = '') {
  contextStatus.textContent = message;
  contextStatus.className = 'context-status' + (cls ? ' ' + cls : '');
}

function contextUnavailableMessage(error) {
  if (error?.code === 'CODESURF_NO_CONTEX' || error?.status === 503 || !contexConnected) {
    return 'Contex is not started. Local canvas still works. Start CodeSurf with --contex to edit objectives, skills, and context.';
  }
  return error?.message || 'Could not load context.';
}

function renderContextItems(root, items, renderItem, emptyText) {
  const list = Array.isArray(items) ? items : [];
  root.classList.toggle('empty', list.length === 0);
  root.innerHTML = list.length ? list.map(renderItem).join('') : emptyText;
}

function applyContextToPanel(ctx = {}) {
  const objective = ctx.objective || {};
  contextObjective.value = objective.markdown || ctx.objective_markdown || '';
  renderContextItems(contextSkillsList, ctx.skills, (skill) => `
    <div class="context-item">
      <code>${escapeHtml(skill.skill_key || skill.key || 'skill')}</code>
      <span>${skill.enabled === false ? 'disabled' : 'enabled'} · ${escapeHtml(skill.source || 'unknown')}</span>
    </div>`, 'No skills configured for this Tile.');
  renderContextItems(contextAttachmentsList, ctx.attachments, (att) => `
    <div class="context-item">
      <code>${escapeHtml(att.label || att.uri || 'attachment')}</code>
      <span>${escapeHtml(att.kind || 'file')}</span>
    </div>`, 'No context attachments for this Tile.');
  const version = objective.version ? ` v${objective.version}` : '';
  const reload = objective.reload_required ? ' · reload required' : '';
  setContextStatus(`Loaded context${version}${reload}.`, objective.reload_required ? 'error' : 'saved');
}

async function refreshContextPanel() {
  if (!activeContextTileId) return;
  try {
    setContextStatus('Loading context…');
    const { context } = await api('GET', `/api/contex/context/${encodeURIComponent(activeContextTileId)}`);
    applyContextToPanel(context || {});
  } catch (e) {
    contextObjective.value = '';
    renderContextItems(contextSkillsList, [], () => '', 'No skills loaded.');
    renderContextItems(contextAttachmentsList, [], () => '', 'No attachments loaded.');
    setContextStatus(contextUnavailableMessage(e), 'error');
  }
}

function openContextDialog(tileId) {
  const tile = tileById(tileId);
  if (!tile) return;
  activeContextTileId = tileId;
  dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  contextTitle.textContent = `Context: ${tile.title || tile.type || 'Tile'}`;
  contextSubtitle.textContent = `${tile.type || 'tile'} · ${tile.id}`;
  contextSkillKey.value = '';
  contextSkillEnabled.checked = true;
  contextAttachmentKind.value = 'file';
  contextAttachmentLabel.value = '';
  contextAttachmentUri.value = '';
  setContextStatus(contexConnected ? 'Ready.' : contextUnavailableMessage({ code: 'CODESURF_NO_CONTEX' }), contexConnected ? '' : 'error');
  if (!contextDialog.open) contextDialog.showModal();
  queueMicrotask(() => contextObjective.focus());
  if (contexConnected) refreshContextPanel();
  else {
    contextObjective.value = '';
    renderContextItems(contextSkillsList, [], () => '', 'No skills loaded.');
    renderContextItems(contextAttachmentsList, [], () => '', 'No attachments loaded.');
  }
}

async function saveContextObjective() {
  if (!activeContextTileId) return;
  try {
    setContextStatus('Saving objective…');
    await api('POST', `/api/contex/context/${encodeURIComponent(activeContextTileId)}/objective`, {
      markdown: contextObjective.value,
      rules: [],
      generated_by: 'codesurf-ui',
    });
    setContextStatus('Objective saved. Agents may need to reload it.', 'saved');
    showToast('Objective saved to Contex.');
  } catch (e) {
    setContextStatus(contextUnavailableMessage(e), 'error');
  }
}

async function saveContextSkill() {
  if (!activeContextTileId) return;
  const skillKey = contextSkillKey.value.trim();
  if (!skillKey) {
    setContextStatus('Enter a skill key before saving.', 'error');
    contextSkillKey.focus();
    return;
  }
  try {
    setContextStatus('Saving skill…');
    await api('POST', `/api/contex/context/${encodeURIComponent(activeContextTileId)}/skills`, {
      skill_key: skillKey,
      enabled: contextSkillEnabled.checked,
      source: 'codesurf-ui',
    });
    setContextStatus('Skill saved.', 'saved');
    await refreshContextPanel();
  } catch (e) {
    setContextStatus(contextUnavailableMessage(e), 'error');
  }
}

async function addContextAttachment() {
  if (!activeContextTileId) return;
  const uri = contextAttachmentUri.value.trim();
  if (!uri) {
    setContextStatus('Enter an attachment URI before adding it.', 'error');
    contextAttachmentUri.focus();
    return;
  }
  try {
    setContextStatus('Adding attachment…');
    await api('POST', `/api/contex/context/${encodeURIComponent(activeContextTileId)}/attachments`, {
      kind: contextAttachmentKind.value || 'file',
      label: contextAttachmentLabel.value.trim() || uri,
      uri,
    });
    contextAttachmentLabel.value = '';
    contextAttachmentUri.value = '';
    setContextStatus('Attachment added.', 'saved');
    await refreshContextPanel();
  } catch (e) {
    setContextStatus(contextUnavailableMessage(e), 'error');
  }
}

async function reloadContextObjective() {
  if (!activeContextTileId) return;
  try {
    setContextStatus('Acknowledging objective reload…');
    await api('POST', `/api/contex/context/${encodeURIComponent(activeContextTileId)}/reload`);
    setContextStatus('Reload acknowledged.', 'saved');
    await refreshContextPanel();
  } catch (e) {
    setContextStatus(contextUnavailableMessage(e), 'error');
  }
}

$('#ctx-close').addEventListener('click', () => contextDialog.close());
$('#ctx-refresh').addEventListener('click', refreshContextPanel);
$('#ctx-save-objective').addEventListener('click', saveContextObjective);
$('#ctx-save-skill').addEventListener('click', saveContextSkill);
$('#ctx-add-attachment').addEventListener('click', addContextAttachment);
$('#ctx-reload').addEventListener('click', reloadContextObjective);
contextDialog.addEventListener('close', () => {
  activeContextTileId = null;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
});

// flush any pending layout edit + release the lock on unload (best effort)
window.addEventListener('beforeunload', () => {
  if (!app.workspaceId) return;
  if (dirty) {
    clearTimeout(saveTimer);
    // keepalive lets this PUT complete after the page goes away (no debounce loss)
    try {
      fetch(`/api/workspaces/${app.workspaceId}/layout`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layout: layoutPayload() }), keepalive: true,
      });
    } catch { /* best effort */ }
  }
  navigator.sendBeacon?.(`/api/workspaces/${app.workspaceId}/close`, '');
});

// ---- Contex integration -------------------------------------------------
const contexPill = $('#contex');
const contexHelp = $('#contex-help');
let contexConnected = false;

function setContexStatus(status) {
  const display = {
    connected: {
      text: '● Contex: connected',
      title: 'Agent collaboration, messages, and canvas commands are available.',
      detail: 'Agents, chat, and canvas commands available.',
    },
    connecting: {
      text: '◌ Contex: connecting…',
      title: 'Connecting the optional coordination backend. Local canvas actions remain available.',
      detail: 'Connecting; local canvas still works.',
    },
    offline: {
      text: '⚠ Contex: offline',
      title: 'The coordination backend is unavailable. Local canvas actions remain available.',
      detail: 'Backend unavailable; local mode continues.',
    },
    error: {
      text: '⚠ Contex: connection failed',
      title: 'The coordination backend could not connect. Local canvas actions remain available.',
      detail: 'Start with --contex or keep working locally.',
    },
    disconnected: {
      text: '○ Contex: not started',
      title: 'Local canvas actions work normally. Start CodeSurf with --contex to enable agent collaboration.',
      detail: 'Local mode. Start with --contex for agents.',
    },
  }[status] || {
    text: `○ Contex: ${status || 'unknown'}`,
    title: 'Local canvas actions remain available.',
    detail: 'Local canvas actions remain available.',
  };
  const was = contexConnected;
  contexConnected = status === 'connected';
  contexPill.textContent = display.text;
  contexPill.title = display.title;
  contexPill.setAttribute('aria-label', display.title);
  contexPill.className = 'contex ' + status;
  contexHelp.textContent = display.detail;
  contexHelp.title = display.title;
  if (contexConnected && !was) {
    mirrorAllLinks();
    registerAllChatTiles();
    refreshStatusView({ quiet: true });
    refreshHumanAttention({ quiet: true });
    refreshAllTimelines({ quiet: true });
  } // sync canvas links, chat tiles, and status views when Contex comes up
  if (!contexConnected && was) {
    refreshStatusView({ quiet: true });
    refreshHumanAttention({ quiet: true });
    refreshAllTimelines({ quiet: true });
  }
}

// mirror every existing canvas link into Contex (so a saved workspace's links
// become peer edges once Contex connects, not only freshly-drawn ones)
function mirrorAllLinks() {
  for (const l of links()) contexMirrorLink('POST', l);
}

async function contexMirrorLink(method, link) {
  if (!contexConnected) return; // no backend → skip the mirror (avoids 503 noise)
  try {
    if (method === 'POST') setLinkSync(link, 'syncing');
    const res = await fetch('/api/contex/links', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: link.source,
        target: link.target,
        directed: link.directed !== false,
        kind: link.kind || '',
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    if (method === 'POST') setLinkSync(link, 'synced');
  } catch {
    if (method === 'POST') setLinkSync(link, 'sync_failed');
    showToast('Local link kept, but Contex sync failed.', { tone: 'warning' });
  }
}

// drive a tile's status dot from a Contex tile_state_changed notification
function applyTileState(params) {
  if (!params || !params.tile_id) return;
  const t = tileById(params.tile_id);
  if (!t || !params.status) return;
  t.status = params.status;
  const dot = world.querySelector(`.tile[data-id="${params.tile_id}"] .head .dot`);
  if (dot) { dot.className = 'dot status-' + params.status; dot.title = params.status; }
  if (params.status === 'blocked' || params.status === 'waiting') refreshHumanAttention({ quiet: true });
  else clearAttention(params.tile_id);
  refreshAllTimelines({ quiet: true });
}

function startContex() {
  fetch('/api/contex/status').then((r) => r.json()).then((s) => {
    setContexStatus(s.status);
    // only open the live stream when a backend is actually present (avoids a 503
    // EventSource loop in canvas-only mode)
    if (s.status !== 'disconnected') openContexStream();
  }).catch(() => setContexStatus('disconnected'));
}

function openContexStream() {
  try {
    const es = new EventSource('/api/contex/events'); // EventSource auto-reconnects
    es.addEventListener('status', (e) => setContexStatus(JSON.parse(e.data).status));
    es.addEventListener('tile_state', (e) => applyTileState(JSON.parse(e.data)));
    es.addEventListener('command', (e) => handleCanvasCommand(JSON.parse(e.data)));
    es.addEventListener('notification', (e) => handleContexNotification(JSON.parse(e.data)));
    es.onerror = () => { /* EventSource retries on its own */ };
  } catch { /* no Contex endpoint — leave the pill as-is */ }
}

// An agent asked the canvas to do something (Phase-8 command bus). Perform it,
// then report the result so the agent's canvas_command_result resolves.
// Delivery is at-least-once, so de-dup by command id.
const handledCommands = new Set();
async function handleCanvasCommand(cmd) {
  if (!cmd || !cmd.id || handledCommands.has(cmd.id)) return;
  handledCommands.add(cmd.id);
  const p = cmd.payload || {};
  try {
    let result = {};
    if (cmd.kind === 'create_tile') {
      const req = cmd.requester_tile_id ? tileById(cmd.requester_tile_id) : null;
      let x, y;
      if (p.position_hint && Number.isFinite(p.position_hint.x)) { x = p.position_hint.x; y = p.position_hint.y; }
      else if (req) { x = req.x + req.w + 60; y = req.y; }
      else { const r = visibleWorldRect(); x = r.x + r.w / 2 - 110; y = r.y + r.h / 2 - 70; }
      const t = addTile(x, y, p.tile_type || 'note');
      if (p.title) t.title = p.title;
      if (p.tile_type === 'document' && p.content) t.data = { ...t.data, text: p.content };       // (C) fill a doc
      if (p.tile_type === 'terminal' && p.command) t.data = { ...t.data, command: p.command, autostart: true }; // (B) auto-run a worker
      replaceTileEl(t); // re-render with the new title/data (terminal autostart fires in wireTerminal)
      if (p.link_to_requester && req) addLink(cmd.requester_tile_id, t.id);
      result = { tile_id: t.id };
    } else if (cmd.kind === 'focus') {
      const t = tileById(p.tile_id);
      if (t) { select(t.id); centerOn(t.x + t.w / 2, t.y + t.h / 2); }
      result = { focused: !!t };
    } else if (cmd.kind === 'highlight') {
      const t = tileById(p.tile_id);
      if (t) flashTile(t.id);
      result = { highlighted: !!t };
    } else if (cmd.kind === 'connect') {
      if (tileById(p.source_tile_id) && tileById(p.target_tile_id)) addLink(p.source_tile_id, p.target_tile_id);
      result = { connected: true };
    } else if (cmd.kind === 'terminal_input') {
      const tid = cmd.target_tile_id;
      if (p.text != null) await api('POST', `/api/terminals/${tid}/input`, { data: p.text });
      if (p.control) await api('POST', `/api/terminals/${tid}/control`, { action: p.control === 'ctrl-c' ? 'interrupt' : p.control });
      result = { delivered: true };
    } else {
      result = { ignored: cmd.kind };
    }
    await api('POST', `/api/contex/commands/${cmd.id}/complete`, { result });
  } catch (err) {
    await api('POST', `/api/contex/commands/${cmd.id}/complete`, { error: String(err.message || err) }).catch(() => {});
  }
}

function flashTile(id) {
  const el = world.querySelector(`.tile[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

// ---- Human handoff (Agent Platform UI Phase B) -------------------------
const pendingAttention = new Map(); // tileId -> attention row
const agentHandoffTiles = new Map(); // tileId -> { root, question, status, input }

function attentionId(row) {
  return row?.tile_id || row?.agent_id || row?.id || '';
}

function normalizeAttention(row) {
  const id = attentionId(row);
  if (!id) return null;
  return {
    agent_id: row.agent_id || id,
    tile_id: row.tile_id || id,
    status: row.status || 'blocked',
    role: row.role || '',
    runtime: row.runtime || '',
    text: row.text || row.blocker || row.question || row.reason || row.summary || 'Agent needs human input.',
    task: row.task || '',
    blocker: row.blocker || row.text || '',
    severity: row.severity || '',
    task_id: row.task_id || row.taskId || '',
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

function upsertAttention(row) {
  const normalized = normalizeAttention(row);
  if (!normalized) return;
  pendingAttention.set(normalized.tile_id, normalized);
  renderAttention();
  renderAgentHandoff(normalized.tile_id);
}

function clearAttention(tileId) {
  pendingAttention.delete(tileId);
  renderAttention();
  renderAgentHandoff(tileId);
}

function renderAttention() {
  if (!attentionList) return;
  const rows = [...pendingAttention.values()].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  attentionList.classList.toggle('empty', rows.length === 0);
  if (!rows.length) {
    attentionList.textContent = contexConnected ? 'No pending human requests.' : 'Connect Contex to see human requests.';
    return;
  }
  attentionList.innerHTML = rows.map((row) => {
    const meta = [row.status, row.role, row.task_id || row.task].filter(Boolean).join(' · ');
    return `<article class="attention-item" data-tile-id="${escapeHtml(row.tile_id)}">
      <b>${escapeHtml(row.agent_id || row.tile_id)}</b>
      <p>${escapeHtml(row.text)}</p>
      <span class="attention-meta">${escapeHtml(meta)}</span>
      <div class="attention-actions">
        <button class="attention-focus" type="button">Focus</button>
        <button class="attention-handled" type="button">Mark handled</button>
      </div>
    </article>`;
  }).join('');
}

function renderAgentHandoff(tileId) {
  const ui = agentHandoffTiles.get(tileId);
  if (!ui?.root) return;
  const row = pendingAttention.get(tileId);
  ui.root.hidden = !row;
  if (!row) return;
  ui.question.textContent = row.text;
  ui.status.textContent = [row.status, row.severity].filter(Boolean).join(' · ') || 'blocked';
}

function renderAllAgentHandoffs() {
  for (const tileId of agentHandoffTiles.keys()) renderAgentHandoff(tileId);
}

async function refreshHumanAttention({ quiet = false } = {}) {
  if (!contexConnected) {
    pendingAttention.clear();
    renderAttention();
    renderAllAgentHandoffs();
    return;
  }
  try {
    const data = await api('GET', '/api/contex/human-attention');
    pendingAttention.clear();
    for (const row of data.attention || []) upsertAttention(row);
    renderAttention();
    renderAllAgentHandoffs();
  } catch (e) {
    if (attentionList) {
      attentionList.classList.add('empty');
      attentionList.textContent = e.message || 'Human attention unavailable.';
    }
    if (!quiet) showToast(e.message || 'Human attention unavailable.', { tone: 'warning' });
  }
}

async function sendHumanAttentionAction(tileId, action, { text = '' } = {}) {
  try {
    await api('POST', `/api/contex/human-attention/${encodeURIComponent(tileId)}/${action}`, { text });
    clearAttention(tileId);
    const t = tileById(tileId);
    if (t && action !== 'reject') {
      t.status = action === 'reply' ? 'working' : 'idle';
      replaceTileEl(t);
    }
    showToast(action === 'reply' ? 'Reply sent to Agent.' : action === 'reject' ? 'Request rejected.' : 'Request marked handled.');
    await Promise.all([
      refreshHumanAttention({ quiet: true }),
      refreshStatusView({ quiet: true }),
      refreshAllTimelines({ quiet: true }),
    ]);
  } catch (e) {
    showToast(e.message || 'Human handoff action failed.', { tone: 'warning' });
  }
}

function wireAgentHandoff(el, tile) {
  const root = el.querySelector('.agent-handoff');
  if (!root) return;
  const ui = {
    root,
    question: root.querySelector('.agent-handoff-question'),
    status: root.querySelector('.agent-handoff-status'),
    input: root.querySelector('.agent-handoff-reply'),
  };
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    if (e.target.classList.contains('agent-handoff-send')) {
      sendHumanAttentionAction(tile.id, 'reply', { text: ui.input.value.trim() });
    } else if (e.target.classList.contains('agent-handoff-reject')) {
      sendHumanAttentionAction(tile.id, 'reject', { text: ui.input.value.trim() || 'Rejected by human.' });
    } else if (e.target.classList.contains('agent-handoff-handled')) {
      sendHumanAttentionAction(tile.id, 'handled');
    }
  });
  ui.input?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendHumanAttentionAction(tile.id, 'reply', { text: ui.input.value.trim() });
    }
  });
  agentHandoffTiles.set(tile.id, ui);
  renderAgentHandoff(tile.id);
}

attentionRefresh?.addEventListener('click', () => refreshHumanAttention({ quiet: false }));
attentionList?.addEventListener('click', (e) => {
  const item = e.target.closest('.attention-item');
  const tileId = item?.dataset.tileId;
  if (!tileId) return;
  if (e.target.classList.contains('attention-focus')) focusStatusSource(tileId);
  else if (e.target.classList.contains('attention-handled')) sendHumanAttentionAction(tileId, 'handled');
});

// ---- Agent actions (Agent Platform UI Phase C) -------------------------
async function runAgentAction(tileId, action, body, statusEl) {
  if (!contexConnected) {
    statusEl.textContent = 'Contex is not started.';
    showToast('Start CodeSurf with --contex to run Agent actions.', { tone: 'warning' });
    return;
  }
  statusEl.textContent = 'Running ' + action + '...';
  try {
    const out = await api('POST', `/api/contex/agent-actions/${encodeURIComponent(tileId)}/${action}`, body);
    const result = out?.result || {};
    const delivered = Number.isFinite(result.delivered) ? ` · ${result.delivered} delivered` : '';
    const failed = Number.isFinite(result.failed) && result.failed ? ` · ${result.failed} failed` : '';
    statusEl.textContent = `${action} complete${delivered}${failed}`;
    showToast(`${action[0].toUpperCase() + action.slice(1)} complete${failed ? ' with failures.' : '.'}`, { tone: failed ? 'warning' : '' });
    await Promise.all([
      refreshStatusView({ quiet: true }),
      refreshAllTimelines({ quiet: true }),
      refreshHumanAttention({ quiet: true }),
    ]);
  } catch (e) {
    statusEl.textContent = e.message || `${action} failed.`;
    showToast(e.message || `${action} failed.`, { tone: 'warning' });
  }
}

function wireAgentActions(el, tile) {
  const root = el.querySelector('.agent-actions');
  if (!root) return;
  const body = root.querySelector('.agent-actions-body');
  const toggle = root.querySelector('.agent-actions-toggle');
  const task = root.querySelector('.agent-action-task');
  const target = root.querySelector('.agent-action-target');
  const role = root.querySelector('.agent-action-role');
  const text = root.querySelector('.agent-action-text');
  const status = root.querySelector('.agent-action-status');
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  toggle?.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? 'Open' : 'Close';
  });
  root.addEventListener('click', (e) => {
    const payload = {
      task_id: task.value.trim(),
      to_agent_id: target.value.trim(),
      role: role.value,
      text: text.value.trim(),
      result_summary: text.value.trim(),
    };
    if (e.target.classList.contains('agent-action-claim')) runAgentAction(tile.id, 'claim', payload, status);
    else if (e.target.classList.contains('agent-action-complete')) runAgentAction(tile.id, 'complete', payload, status);
    else if (e.target.classList.contains('agent-action-handoff')) runAgentAction(tile.id, 'handoff', payload, status);
    else if (e.target.classList.contains('agent-action-report')) runAgentAction(tile.id, 'report', payload, status);
    else if (e.target.classList.contains('agent-action-broadcast')) runAgentAction(tile.id, 'broadcast', payload, status);
  });
}

// ---- Agent timeline (Agent Platform UI Phase A) ------------------------
const agentTimelineTiles = new Map(); // tileId -> { root, list }
let latestWorkspaceTimeline = { events: [] };

function timelineEventsFrom(data) {
  return Array.isArray(data?.events) ? data.events : [];
}

function timelineTimeLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timelineActorLabel(event) {
  return event.actor_id || event.tile_id || event.payload?.from || event.payload?.to || '';
}

function timelineFocusId(event) {
  return event.tile_id || event.actor_id || event.payload?.owner_tile_id || event.payload?.from || event.payload?.to || '';
}

function timelineCategoryLabel(category) {
  return ({
    status: 'state',
    message: 'msg',
    task: 'task',
    link: 'link',
    notification: 'note',
    command: 'cmd',
    integration: 'int',
  })[category] || (category || 'event').slice(0, 5);
}

function renderTimelineList(root, events, { empty = 'No activity yet.' } = {}) {
  if (!root) return;
  const rows = [...events].sort((a, b) => (b.sequence || 0) - (a.sequence || 0));
  root.classList.toggle('empty', rows.length === 0);
  if (!rows.length) {
    root.textContent = empty;
    return;
  }
  root.innerHTML = rows.slice(0, 40).map((event) => {
    const category = event.category || 'audit';
    const focusId = timelineFocusId(event);
    const meta = [
      timelineTimeLabel(event.created_at),
      timelineActorLabel(event),
      event.event_type,
    ].filter(Boolean).join(' · ');
    return `<article class="timeline-item category-${escapeHtml(category)}">
      <span class="timeline-badge">${escapeHtml(timelineCategoryLabel(category))}</span>
      <div class="timeline-main">
        <div class="timeline-summary">${escapeHtml(event.summary || event.event_type || 'Activity')}</div>
        <div class="timeline-meta">${escapeHtml(meta)}</div>
        ${focusId ? `<button class="timeline-focus" type="button" data-tile-id="${escapeHtml(focusId)}">focus ${escapeHtml(shortId(focusId))}</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

async function refreshWorkspaceTimeline({ quiet = false } = {}) {
  if (!activityList) return;
  if (!contexConnected) {
    latestWorkspaceTimeline = { events: [] };
    renderTimelineList(activityList, [], { empty: 'Connect Contex to see collaboration activity.' });
    return;
  }
  try {
    latestWorkspaceTimeline = await api('GET', '/api/contex/timeline?limit=60');
    renderTimelineList(activityList, timelineEventsFrom(latestWorkspaceTimeline), { empty: 'No workspace activity yet.' });
  } catch (e) {
    renderTimelineList(activityList, [], { empty: e.message || 'Timeline unavailable.' });
    if (!quiet) showToast(e.message || 'Timeline unavailable.', { tone: 'warning' });
  }
}

async function refreshAgentTimeline(tileId, { quiet = true } = {}) {
  const ui = agentTimelineTiles.get(tileId);
  if (!ui?.list) return;
  if (!contexConnected) {
    renderTimelineList(ui.list, [], { empty: 'Connect Contex to see this Agent timeline.' });
    return;
  }
  try {
    const data = await api('GET', `/api/contex/timeline/${encodeURIComponent(tileId)}?limit=20`);
    renderTimelineList(ui.list, timelineEventsFrom(data), { empty: 'No Agent activity yet.' });
  } catch (e) {
    renderTimelineList(ui.list, [], { empty: e.message || 'Agent timeline unavailable.' });
    if (!quiet) showToast(e.message || 'Agent timeline unavailable.', { tone: 'warning' });
  }
}

function refreshAllTimelines({ quiet = true } = {}) {
  refreshWorkspaceTimeline({ quiet });
  for (const tileId of agentTimelineTiles.keys()) refreshAgentTimeline(tileId, { quiet: true });
}

function wireAgentTimeline(el, tile) {
  const root = el.querySelector('.agent-activity');
  const list = el.querySelector('.agent-activity-list');
  if (!root || !list) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    const focus = e.target.closest('.timeline-focus');
    if (focus) focusStatusSource(focus.dataset.tileId);
    else if (e.target.classList.contains('agent-activity-refresh')) refreshAgentTimeline(tile.id, { quiet: false });
  });
  agentTimelineTiles.set(tile.id, { root, list });
  refreshAgentTimeline(tile.id, { quiet: true });
}

activityRefresh?.addEventListener('click', () => refreshWorkspaceTimeline({ quiet: false }));
activityFeed?.addEventListener('mousedown', (e) => e.stopPropagation());
activityFeed?.addEventListener('click', (e) => {
  const focus = e.target.closest('.timeline-focus');
  if (focus) focusStatusSource(focus.dataset.tileId);
});

// ---- browser + document tiles (Phase 9) --------------------------------
function nowLabel() {
  return new Date().toLocaleTimeString();
}

function rememberRevision(tile, reason) {
  const revisions = Array.isArray(tile.data.revisions) ? tile.data.revisions.slice(-7) : [];
  revisions.push({ at: new Date().toISOString(), reason, text: tile.data.text || '' });
  tile.data.revisions = revisions;
}

function setBrowserConsole(el, message) {
  const consoleEl = el.querySelector('.browser-console');
  if (consoleEl) consoleEl.textContent = message;
}

function renderBrowserFindings(el, tile) {
  const root = el.querySelector('.browser-findings');
  if (!root) return;
  const findings = Array.isArray(tile.data.findings) ? tile.data.findings : [];
  root.innerHTML = findings.map((f) =>
    `<div class="finding"><b>${escapeHtml(f.url || 'page')}</b><span>${escapeHtml(f.text || '')}</span></div>`).join('');
}

async function sendLinkedTileMessage(tileId, text) {
  const recipients = linkedTileIds(tileId);
  if (recipients.length === 0) {
    showToast('Link this Tile to an agent or chat first.', { tone: 'warning' });
    return false;
  }
  if (!contexConnected) {
    showToast('Contex is not started; message saved locally only.', { tone: 'warning' });
    return false;
  }
  await api('POST', `/api/contex/chat/${tileId}/send`, { text, recipients });
  return true;
}

function wireBrowserTile(el, tile) {
  const root = el.querySelector('.browser-tile');
  const input = el.querySelector('.browser-url');
  const frame = el.querySelector('.browser-frame');
  const finding = el.querySelector('.browser-finding');
  if (!root || !input || !frame) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  function loadUrl() {
    const url = input.value.trim() || 'http://127.0.0.1:3000/';
    tile.data.url = url;
    tile.data.console = `Loading ${url}…`;
    frame.src = url;
    setBrowserConsole(el, tile.data.console);
    scheduleSave();
  }
  input.addEventListener('input', () => { tile.data.url = input.value; scheduleSave(); });
  finding?.addEventListener('input', () => { tile.data.finding = finding.value; scheduleSave(); });
  el.querySelector('.browser-go')?.addEventListener('click', loadUrl);
  el.querySelector('.browser-reload')?.addEventListener('click', () => {
    tile.data.console = `Reloaded ${tile.data.url || frame.src} at ${nowLabel()}.`;
    setBrowserConsole(el, tile.data.console);
    try { frame.contentWindow?.location.reload(); }
    catch { frame.src = tile.data.url || input.value; }
  });
  frame.addEventListener('load', () => {
    tile.data.console = `Loaded ${tile.data.url || frame.src} at ${nowLabel()}.`;
    setBrowserConsole(el, tile.data.console);
    scheduleSave();
  });
  el.querySelector('.browser-send-finding')?.addEventListener('click', async () => {
    const text = (finding?.value || '').trim();
    if (!text) {
      showToast('Write a finding before sending it.', { tone: 'warning' });
      finding?.focus();
      return;
    }
    const item = { at: new Date().toISOString(), url: tile.data.url || input.value, text };
    tile.data.findings = [...(Array.isArray(tile.data.findings) ? tile.data.findings : []), item].slice(-8);
    tile.data.finding = '';
    if (finding) finding.value = '';
    renderBrowserFindings(el, tile);
    scheduleSave();
    const sent = await sendLinkedTileMessage(tile.id, `Browser finding for ${item.url}:\n\n${text}`).catch((e) => {
      showToast(e.message || 'Could not send finding.', { tone: 'warning' });
      return false;
    });
    if (sent) showToast('Finding sent to linked agent.');
  });
}

function markdownPreviewClient(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    if (line.startsWith('# ')) return `<h3>${escapeHtml(line.slice(2))}</h3>`;
    if (line.startsWith('## ')) return `<h4>${escapeHtml(line.slice(3))}</h4>`;
    if (/^\s*[-*]\s+/.test(line)) return `<p class="md-bullet">${escapeHtml(line.replace(/^\s*[-*]\s+/, ''))}</p>`;
    if (!line.trim()) return '<br />';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

function documentPreset(name) {
  if (name === 'objective') return '# Objective\n\n- Goal:\n- Constraints:\n- Done when:\n';
  if (name === 'spec') return '# Spec\n\n## Context\n\n## Requirements\n\n## Risks\n';
  return '# Plan\n\n- Step 1:\n- Step 2:\n- Verify:\n';
}

function updateDocumentPreview(el, tile) {
  const preview = el.querySelector('.document-preview');
  if (preview) preview.innerHTML = markdownPreviewClient(tile.data.text || '');
}

function renderDocumentComments(el, tile) {
  const root = el.querySelector('.document-comments');
  if (!root) return;
  const comments = Array.isArray(tile.data.comments) ? tile.data.comments : [];
  root.innerHTML = comments.map((c) =>
    `<div class="doc-comment"><span>${escapeHtml(c.at || '')}</span>${escapeHtml(c.text || '')}</div>`).join('');
}

function renderDocumentHistory(el, tile) {
  const root = el.querySelector('.document-history');
  if (!root) return;
  const n = Array.isArray(tile.data.revisions) ? tile.data.revisions.length : 0;
  root.textContent = n ? `${n} saved revision${n === 1 ? '' : 's'}` : 'No saved revisions yet.';
}

function wireDocumentTile(el, tile) {
  const root = el.querySelector('.document-tile');
  const editor = el.querySelector('.document-editor');
  const fileInput = el.querySelector('.document-file');
  const preview = el.querySelector('.document-preview');
  const comment = el.querySelector('.document-comment');
  if (!root || !editor) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  editor.addEventListener('input', () => {
    tile.data.text = editor.value;
    updateDocumentPreview(el, tile);
    scheduleSave();
  });
  fileInput?.addEventListener('input', () => { tile.data.filePath = fileInput.value; scheduleSave(); });
  el.querySelector('.document-toggle')?.addEventListener('click', () => {
    tile.data.mode = tile.data.mode === 'preview' ? 'edit' : 'preview';
    rememberRevision(tile, tile.data.mode === 'preview' ? 'preview' : 'edit');
    replaceTileEl(tile);
    scheduleSave();
  });
  el.querySelectorAll('.document-preset').forEach((button) => {
    button.addEventListener('click', () => {
      rememberRevision(tile, 'preset');
      tile.data.text = documentPreset(button.dataset.preset);
      editor.value = tile.data.text;
      updateDocumentPreview(el, tile);
      renderDocumentHistory(el, tile);
      scheduleSave();
    });
  });
  el.querySelector('.document-load-file')?.addEventListener('click', async () => {
    const relPath = (fileInput?.value || '').trim();
    if (!relPath) {
      showToast('Enter a repository-relative file path.', { tone: 'warning' });
      fileInput?.focus();
      return;
    }
    try {
      const { content, bytes } = await api('GET', `/api/workspaces/${app.workspaceId}/file?path=${encodeURIComponent(relPath)}`);
      rememberRevision(tile, 'load file');
      tile.data.filePath = relPath;
      tile.data.text = content;
      editor.value = content;
      updateDocumentPreview(el, tile);
      renderDocumentHistory(el, tile);
      scheduleSave();
      showToast(`Loaded ${relPath} (${bytes} bytes).`);
    } catch (e) {
      showToast(e.message || 'Could not load repository file.', { tone: 'warning' });
    }
  });
  el.querySelector('.document-add-comment')?.addEventListener('click', () => {
    const text = (comment?.value || '').trim();
    if (!text) return;
    tile.data.comments = [...(Array.isArray(tile.data.comments) ? tile.data.comments : []), {
      at: new Date().toISOString(),
      text,
    }].slice(-12);
    if (comment) comment.value = '';
    renderDocumentComments(el, tile);
    scheduleSave();
  });
  el.querySelector('.document-send-selection')?.addEventListener('click', async () => {
    const selected = editor.value.slice(editor.selectionStart || 0, editor.selectionEnd || 0).trim();
    const text = selected || (tile.data.text || '').trim();
    if (!text) {
      showToast('Select or write document text before sending.', { tone: 'warning' });
      return;
    }
    const sent = await sendLinkedTileMessage(tile.id, `Document context from ${tile.title || 'Document'}:\n\n${text}`).catch((e) => {
      showToast(e.message || 'Could not send document context.', { tone: 'warning' });
      return false;
    });
    if (sent) showToast('Document context sent to linked agent.');
  });
  if (tile.data.mode === 'preview') {
    editor.hidden = true;
    if (preview) preview.hidden = false;
  }
}

// ---- git tiles (Phase 10: branch, diff, and worktree visibility) --------
function renderGitStatus(el, status = {}) {
  const summary = el.querySelector('.git-summary');
  const filesRoot = el.querySelector('.git-files');
  const worktreesRoot = el.querySelector('.git-worktrees');
  if (!summary || !filesRoot || !worktreesRoot) return;
  const branch = status.branch || {};
  const files = Array.isArray(status.files) ? status.files : [];
  const worktrees = Array.isArray(status.worktrees) ? status.worktrees : [];
  const branchLabel = branch.name || 'unknown';
  summary.textContent = `${branchLabel}${branch.protected ? ' · protected' : ''} · ${files.length} changed`;
  filesRoot.classList.toggle('empty', files.length === 0);
  filesRoot.innerHTML = files.length ? files.map((file) =>
    `<div class="git-file"><code>${escapeHtml(file.status || '')}</code><span>${escapeHtml(file.path || '')}</span></div>`).join('')
    : (status.diffStat ? escapeHtml(status.diffStat) : 'Working tree clean.');
  worktreesRoot.classList.toggle('empty', worktrees.length === 0);
  worktreesRoot.innerHTML = worktrees.length ? worktrees.map((wt) =>
    `<div class="git-worktree"><b>${escapeHtml(wt.branch || (wt.detached ? 'detached' : 'worktree'))}</b><span>${escapeHtml(wt.path || '')}</span></div>`).join('')
    : 'No worktrees reported.';
  const warning = el.querySelector('.git-warning');
  if (warning) warning.textContent = branch.protected
    ? 'Protected branch: use a worktree/feature branch before committing or pushing.'
    : 'Stage, commit, push, and PR actions are intentionally disabled in this slice.';
}

async function refreshGitTile(el, tile, { quiet = false } = {}) {
  if (!app.workspaceId) return;
  try {
    const status = await api('GET', `/api/workspaces/${app.workspaceId}/git/status`);
    tile.data.status = status;
    renderGitStatus(el, status);
    scheduleSave();
  } catch (e) {
    renderGitStatus(el, { branch: { name: 'not a git repo' }, files: [], worktrees: [] });
    if (!quiet) showToast(e.message || 'Could not load Git status.', { tone: 'warning' });
  }
}

function wireGitTile(el, tile) {
  const root = el.querySelector('.git-tile');
  if (!root) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  renderGitStatus(el, tile.data.status || {});
  el.querySelector('.git-refresh')?.addEventListener('click', () => refreshGitTile(el, tile));
  el.querySelector('.git-create-worktree')?.addEventListener('click', async () => {
    const path = el.querySelector('.git-worktree-path')?.value.trim();
    const branch = el.querySelector('.git-worktree-branch')?.value.trim();
    if (!path || !branch) {
      showToast('Enter an absolute worktree path and branch name.', { tone: 'warning' });
      return;
    }
    try {
      await api('POST', `/api/workspaces/${app.workspaceId}/git/worktrees`, { path, branch });
      showToast('Worktree created. Terminal tiles can run from that path.');
      await refreshGitTile(el, tile, { quiet: true });
    } catch (e) {
      showToast(e.message || 'Could not create worktree.', { tone: 'warning' });
    }
  });
  refreshGitTile(el, tile, { quiet: true });
}

// ---- memory tiles (Phase 11: evidence-backed workspace memory) ----------
function renderMemoryTile(el, tile) {
  const memory = tile.data.memory || {};
  const proposal = tile.data.proposal || memory.generated || null;
  const summary = el.querySelector('.memory-summary');
  const sectionsRoot = el.querySelector('.memory-sections');
  const evidenceRoot = el.querySelector('.memory-evidence');
  const pinsRoot = el.querySelector('.memory-pins');
  const markersRoot = el.querySelector('.memory-markers');
  if (summary) summary.textContent = proposal ? `Proposal ${proposal.generatedAt || ''}` : 'No proposal yet';
  if (sectionsRoot) {
    const sections = Array.isArray(proposal?.sections) ? proposal.sections : [];
    sectionsRoot.innerHTML = sections.length ? sections.map((s) =>
      `<section class="memory-section"><h4>${escapeHtml(s.title || 'Section')}</h4><pre>${escapeHtml(s.body || '')}</pre></section>`).join('')
      : '<p class="muted">Generate a proposal from canvas, Git, tasks, and pinned facts.</p>';
  }
  if (evidenceRoot) {
    const evidence = Array.isArray(proposal?.evidence) ? proposal.evidence : [];
    evidenceRoot.innerHTML = evidence.length ? evidence.map((ev) =>
      `<span title="${escapeHtml(ev.label || '')}">${escapeHtml(ev.kind || 'evidence')}</span>`).join('')
      : '<span>No evidence collected yet.</span>';
  }
  if (pinsRoot) {
    const pins = Array.isArray(memory.pins) ? memory.pins : [];
    pinsRoot.innerHTML = pins.map((pin) => `<div class="memory-note pinned">${escapeHtml(pin.text || '')}</div>`).join('');
  }
  if (markersRoot) {
    const markers = Array.isArray(memory.markers) ? memory.markers : [];
    markersRoot.innerHTML = markers.map((m) => `<div class="memory-note ${escapeHtml(m.kind || 'correction')}">${escapeHtml(m.text || '')}</div>`).join('');
  }
}

async function refreshMemoryTile(el, tile, { quiet = false } = {}) {
  try {
    const { memory } = await api('GET', `/api/workspaces/${app.workspaceId}/memory`);
    tile.data.memory = memory;
    renderMemoryTile(el, tile);
    scheduleSave();
  } catch (e) {
    if (!quiet) showToast(e.message || 'Could not load workspace memory.', { tone: 'warning' });
  }
}

function wireMemoryTile(el, tile) {
  const root = el.querySelector('.memory-tile');
  if (!root) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  renderMemoryTile(el, tile);
  el.querySelector('.memory-refresh')?.addEventListener('click', () => refreshMemoryTile(el, tile));
  el.querySelector('.memory-propose')?.addEventListener('click', async () => {
    try {
      const { proposal } = await api('POST', `/api/workspaces/${app.workspaceId}/memory/proposal`, {});
      tile.data.proposal = proposal;
      renderMemoryTile(el, tile);
      scheduleSave();
      showToast('Workspace Memory proposal generated.');
    } catch (e) {
      showToast(e.message || 'Could not generate memory proposal.', { tone: 'warning' });
    }
  });
  el.querySelector('.memory-accept')?.addEventListener('click', async () => {
    if (!tile.data.proposal) {
      showToast('Generate a memory proposal before accepting it.', { tone: 'warning' });
      return;
    }
    try {
      const { memory } = await api('POST', `/api/workspaces/${app.workspaceId}/memory/accept`, { proposal: tile.data.proposal });
      tile.data.memory = memory;
      tile.data.proposal = null;
      renderMemoryTile(el, tile);
      scheduleSave();
      showToast('Workspace Memory accepted.');
    } catch (e) {
      showToast(e.message || 'Could not accept memory proposal.', { tone: 'warning' });
    }
  });
  el.querySelector('.memory-add-pin')?.addEventListener('click', async () => {
    const input = el.querySelector('.memory-pin-input');
    const text = input?.value.trim();
    if (!text) return;
    const { memory } = await api('POST', `/api/workspaces/${app.workspaceId}/memory/pins`, { text });
    tile.data.memory = memory;
    if (input) input.value = '';
    renderMemoryTile(el, tile);
    scheduleSave();
  });
  const addMarker = async (kind) => {
    const input = el.querySelector('.memory-marker-input');
    const text = input?.value.trim();
    if (!text) return;
    const { memory } = await api('POST', `/api/workspaces/${app.workspaceId}/memory/markers`, { kind, text });
    tile.data.memory = memory;
    if (input) input.value = '';
    renderMemoryTile(el, tile);
    scheduleSave();
  };
  el.querySelector('.memory-add-correction')?.addEventListener('click', () => addMarker('correction'));
  el.querySelector('.memory-add-stale')?.addEventListener('click', () => addMarker('stale'));
  refreshMemoryTile(el, tile, { quiet: true });
}

// ---- status tiles (Phase 8: tasks, file claims, conflict overview) ------
const statusTiles = new Map(); // tileId -> { refresh }
let latestStatusView = { peers: [], tasks: [], claims: [], partial: [] };

function taskId(task) {
  return task.id || task.task_id || task.taskId || task.key || '';
}

function taskTileId(task) {
  return task.tile_id || task.tileId || task.assignee_tile_id || task.assigneeTileId || task.owner_tile_id || '';
}

function taskTitle(task) {
  return task.title || task.summary || task.objective || task.name || taskId(task) || 'Untitled task';
}

function taskStatus(task) {
  return String(task.status || task.state || 'open').toLowerCase();
}

function taskChannel(task) {
  return String(task.channel || task.task_channel || '');
}

function taskIsPolly(task) {
  return taskChannel(task).startsWith('polly:');
}

function pollyItems() {
  if (Array.isArray(latestStatusView.polly?.items)) return latestStatusView.polly.items;
  return (latestStatusView.tasks || []).filter(taskIsPolly).map((task) => {
    const channel = taskChannel(task);
    const registryHash = channel.slice('polly:'.length);
    const owner = taskTileId(task);
    const prefix = `polly:${registryHash}:item:`;
    const summary = task.result_summary || '';
    return {
      registry_hash: registryHash,
      item_id: owner.startsWith(prefix) ? owner.slice(prefix.length) : owner,
      task_id: taskId(task),
      title: taskTitle(task),
      status: taskStatus(task),
      polly_status: summary.match(/^Polly\s+([^·]+)/)?.[1]?.trim() || taskStatus(task),
      owner_tile_id: owner,
      branch: summary.split('·').map((part) => part.trim()).find((part) => part.startsWith('polly/')) || null,
      pr: summary.match(/\bPR #(\d+)/)?.[1] || null,
      blocker: task.blocker || null,
      claims: (latestStatusView.claims || []).filter((claim) => claimTileId(claim) === owner),
    };
  });
}

function claimPath(claim) {
  return claim.path || claim.file || claim.file_path || claim.uri || '';
}

function claimTileId(claim) {
  return claim.tile_id || claim.tileId || claim.owner_tile_id || claim.ownerTileId || claim.peer_tile_id || '';
}

function claimIsConflict(claim) {
  return !!(claim.conflict || claim.conflicted || claim.has_conflict || claim.collision || claim.overlap);
}

function claimIsStale(claim) {
  if (claim.stale === true || claim.expired === true) return true;
  const staleAt = claim.stale_at || claim.expires_at || claim.expiresAt;
  return staleAt ? Date.parse(staleAt) < Date.now() : false;
}

function statusCounts() {
  const tasks = (latestStatusView.tasks || []).filter((task) => !taskIsPolly(task));
  const claims = latestStatusView.claims || [];
  const active = tasks.filter((t) => !['done', 'completed', 'cancelled'].includes(taskStatus(t))).length;
  const blocked = tasks.filter((t) => ['blocked', 'paused'].includes(taskStatus(t))).length;
  const conflicts = claims.filter(claimIsConflict).length;
  const stale = claims.filter(claimIsStale).length;
  return { active, blocked, conflicts, stale };
}

function formatStatusSummary() {
  const c = statusCounts();
  const polly = pollyItems();
  const pollyAttention = polly.filter((item) =>
    ['blocked', 'paused'].includes(String(item.status || '').toLowerCase()) ||
    String(item.polly_status || '').toUpperCase() === 'READY_FOR_HUMAN_MERGE'
  ).length;
  const bits = [`${c.active} active`, `${c.blocked} blocked`, `${polly.length} polly`, `${c.conflicts} conflicts`];
  if (pollyAttention) bits.push(`${pollyAttention} attention`);
  if (c.stale) bits.push(`${c.stale} stale`);
  return bits.join(' · ');
}

function renderStatusTile(el) {
  const summary = el.querySelector('.status-summary');
  const tasksRoot = el.querySelector('.status-tasks');
  const pollyRoot = el.querySelector('.status-polly');
  const claimsRoot = el.querySelector('.status-claims');
  if (!summary || !tasksRoot || !pollyRoot || !claimsRoot) return;
  const tasks = (latestStatusView.tasks || []).filter((task) => !taskIsPolly(task));
  const polly = pollyItems();
  const claims = latestStatusView.claims || [];
  const partial = latestStatusView.partial || [];
  summary.textContent = partial.length ? `${formatStatusSummary()} · partial` : formatStatusSummary();
  tasksRoot.classList.toggle('empty', tasks.length === 0);
  pollyRoot.classList.toggle('empty', polly.length === 0);
  claimsRoot.classList.toggle('empty', claims.length === 0);
  tasksRoot.innerHTML = tasks.length ? tasks.map((task) => {
    const id = taskId(task);
    const owner = taskTileId(task);
    const state = taskStatus(task);
    return `<article class="status-row task-state-${escapeHtml(state)}" data-task-id="${escapeHtml(id)}" data-tile-id="${escapeHtml(owner)}">
      <button class="status-focus" type="button" title="Focus source Tile">${escapeHtml(owner ? shortId(owner) : 'tile')}</button>
      <div class="status-main">
        <b>${escapeHtml(taskTitle(task))}</b>
        <span>${escapeHtml(state)}${task.assignee ? ' · ' + escapeHtml(task.assignee) : ''}</span>
      </div>
      <div class="status-actions">
        <button class="status-task-done" type="button">Done</button>
        <button class="status-task-blocked" type="button">Block</button>
      </div>
    </article>`;
  }).join('') : 'No tasks reported by Contex.';
  pollyRoot.innerHTML = polly.length ? polly.map((item) => {
    const owner = item.owner_tile_id || '';
    const state = String(item.status || 'open').toLowerCase();
    const pollyStatus = String(item.polly_status || state);
    const attention = ['blocked', 'paused'].includes(state) || pollyStatus.toUpperCase() === 'READY_FOR_HUMAN_MERGE';
    const meta = [
      pollyStatus,
      item.item_id ? '#' + item.item_id : '',
      item.pr ? 'PR #' + item.pr : '',
      item.branch || '',
      item.claims?.length ? `${item.claims.length} claim${item.claims.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
    return `<article class="status-row polly task-state-${escapeHtml(state)}${attention ? ' status-attention' : ''}" data-task-id="${escapeHtml(item.task_id || '')}" data-tile-id="${escapeHtml(owner)}">
      <button class="status-focus" type="button" title="Focus Polly item Tile">${escapeHtml(item.item_id ? shortId(item.item_id) : 'tile')}</button>
      <div class="status-main">
        <b>${escapeHtml(item.title || item.item_id || 'Polly item')}</b>
        <span>${escapeHtml(meta || state)}</span>
      </div>
      <div class="status-actions">
        <button class="status-polly-pause" type="button" data-registry-hash="${escapeHtml(item.registry_hash || '')}" data-item-id="${escapeHtml(item.item_id || '')}">Pause</button>
        <button class="status-polly-rerun" type="button" data-registry-hash="${escapeHtml(item.registry_hash || '')}" data-item-id="${escapeHtml(item.item_id || '')}">Rerun</button>
      </div>
    </article>`;
  }).join('') : 'No Polly items reported by Contex.';
  claimsRoot.innerHTML = claims.length ? claims.map((claim) => {
    const path = claimPath(claim);
    const owner = claimTileId(claim);
    const conflict = claimIsConflict(claim);
    const stale = claimIsStale(claim);
    return `<article class="status-row${conflict ? ' conflict' : ''}${stale ? ' stale' : ''}" data-claim-id="${escapeHtml(claim.id || claim.claim_id || '')}" data-path="${escapeHtml(path)}" data-tile-id="${escapeHtml(owner)}">
      <button class="status-focus" type="button" title="Focus source Tile">${escapeHtml(owner ? shortId(owner) : 'tile')}</button>
      <div class="status-main">
        <b>${escapeHtml(path || 'unscoped claim')}</b>
        <span>${conflict ? 'conflict' : stale ? 'stale' : 'claimed'}${claim.mode ? ' · ' + escapeHtml(claim.mode) : ''}</span>
      </div>
      <button class="status-release" type="button">Release</button>
    </article>`;
  }).join('') : 'No file claims reported by Contex.';
}

function renderAllStatusTiles() {
  for (const id of statusTiles.keys()) {
    const el = world.querySelector(`.tile[data-id="${id}"]`);
    if (el) renderStatusTile(el);
  }
}

async function refreshStatusView({ quiet = false } = {}) {
  if (!contexConnected) {
    latestStatusView = { peers: [], tasks: [], claims: [], partial: [{ tool: 'contex', message: 'not connected' }] };
    renderAllStatusTiles();
    if (!quiet) showToast('Contex is not started; status tile is in local mode.', { tone: 'warning' });
    return;
  }
  try {
    latestStatusView = await api('GET', '/api/contex/status-view');
    renderAllStatusTiles();
    const c = statusCounts();
    if (c.conflicts) showToast(`${c.conflicts} file claim conflict${c.conflicts === 1 ? '' : 's'} need attention.`, { tone: 'warning' });
  } catch (e) {
    latestStatusView = { peers: [], tasks: [], claims: [], partial: [{ tool: 'status-view', message: e.message }] };
    renderAllStatusTiles();
    if (!quiet) showToast(contextUnavailableMessage(e), { tone: 'warning' });
  }
}

function focusStatusSource(tileId) {
  const t = tileById(tileId);
  if (!t) {
    showToast('Source Tile is not on this canvas.', { tone: 'warning' });
    return;
  }
  select(t.id);
  centerOn(t.x + t.w / 2, t.y + t.h / 2);
  flashTile(t.id);
}

async function updateTaskStatusFromButton(row, status) {
  const taskIdValue = row?.dataset.taskId;
  if (!taskIdValue) return;
  try {
    await api('POST', `/api/contex/tasks/${encodeURIComponent(taskIdValue)}/status`, {
      status,
      tile_id: row.dataset.tileId || '',
      note: 'Updated from CodeSurf status tile',
    });
    showToast(`Task marked ${status}.`);
    await refreshStatusView({ quiet: true });
  } catch (e) {
    showToast(e.message || 'Task update failed.', { tone: 'warning' });
  }
}

async function releaseClaimFromButton(row) {
  if (!row) return;
  try {
    await api('POST', '/api/contex/claims/release', {
      claim_id: row.dataset.claimId || '',
      path: row.dataset.path || '',
      tile_id: row.dataset.tileId || '',
    });
    showToast('File claim released.');
    await refreshStatusView({ quiet: true });
  } catch (e) {
    showToast(e.message || 'Claim release failed.', { tone: 'warning' });
  }
}

async function requestPollyActionFromButton(button, action) {
  const itemId = button?.dataset.itemId || '';
  const registryHash = button?.dataset.registryHash || '';
  if (!itemId || !registryHash) return;
  const reason = action === 'pause_item'
    ? 'Pause requested from CodeSurf status tile.'
    : 'Gate rerun requested from CodeSurf status tile.';
  try {
    await api('POST', '/api/contex/polly/actions', {
      registry_hash: registryHash,
      item_id: itemId,
      action,
      reason,
    });
    showToast(`Polly request queued for ${itemId}.`);
    await refreshStatusView({ quiet: true });
  } catch (e) {
    showToast(e.message || 'Polly request failed.', { tone: 'warning' });
  }
}

function wireStatusTile(el, tile) {
  const root = el.querySelector('.status-tile');
  if (!root) return;
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.status-row');
    if (e.target.classList.contains('status-refresh')) refreshStatusView();
    else if (e.target.classList.contains('status-focus')) focusStatusSource(row?.dataset.tileId);
    else if (e.target.classList.contains('status-task-done')) updateTaskStatusFromButton(row, 'done');
    else if (e.target.classList.contains('status-task-blocked')) updateTaskStatusFromButton(row, 'blocked');
    else if (e.target.classList.contains('status-release')) releaseClaimFromButton(row);
    else if (e.target.classList.contains('status-polly-pause')) requestPollyActionFromButton(e.target, 'pause_item');
    else if (e.target.classList.contains('status-polly-rerun')) requestPollyActionFromButton(e.target, 'rerun_gates');
  });
  statusTiles.set(tile.id, { refresh: () => refreshStatusView({ quiet: true }) });
  renderStatusTile(el);
  refreshStatusView({ quiet: true });
}

// ---- chat tiles (Phase 6: human ↔ agent) -------------------------------
const chatTiles = new Map(); // tileId -> { refresh }

function linkedTileIds(id) {
  const out = [];
  for (const l of links()) {
    if (l.source === id) out.push(l.target);
    else if (l.target === id) out.push(l.source);
  }
  return out;
}
function shortId(id) { return String(id || '').replace(/^tile_/, '').slice(0, 6); }

function registerChat(tileId) {
  if (contexConnected) api('POST', `/api/contex/chat/${tileId}/register`).catch(() => {});
}
function registerAllChatTiles() {
  for (const t of tiles()) if (t.type === 'chat') registerChat(t.id);
  for (const c of chatTiles.values()) c.refresh?.();
}

function wireChat(el, tile) {
  const log = el.querySelector('.chat-log');
  const input = el.querySelector('.chat-input');
  const sendBtn = el.querySelector('.chat-send');
  if (!log) return;
  el.querySelector('.chat')?.addEventListener('mousedown', (e) => e.stopPropagation());

  const seen = new Set();
  const msgs = [];
  const now = () => new Date().toISOString();
  function render() {
    msgs.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    log.innerHTML = msgs.map((m) =>
      `<div class="msg ${m.from === 'you' ? 'me' : 'them'}"><span class="who">${escapeHtml(m.from === 'you' ? 'you' : shortId(m.from))}</span>${escapeHtml(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  function add(m) { if (m.id && seen.has(m.id)) return; if (m.id) seen.add(m.id); msgs.push(m); render(); }

  async function refresh() {
    if (!contexConnected) return;
    try {
      const { messages } = await api('GET', `/api/contex/chat/${tile.id}/messages`);
      for (const m of messages) add({ id: m.id, from: m.from_tile_id, text: m.text, at: m.created_at });
    } catch { /* offline */ }
  }
  async function send() {
    const text = (input.value || '').trim();
    if (!text) return;
    const recipients = linkedTileIds(tile.id);
    if (recipients.length === 0) { add({ id: 'sys_' + Date.now(), from: 'you', text: '(link this chat to an agent tile first)', at: now() }); return; }
    input.value = '';
    add({ id: 'local_' + Date.now(), from: 'you', text, at: now() });
    if (!contexConnected) { add({ id: 'sys_' + Date.now(), from: 'you', text: '(Contex offline — not delivered)', at: now() }); return; }
    try { await api('POST', `/api/contex/chat/${tile.id}/send`, { text, recipients }); }
    catch (e) { add({ id: 'err_' + Date.now(), from: 'you', text: '(send failed: ' + e.message + ')', at: now() }); }
  }

  sendBtn.addEventListener('click', (e) => { e.stopPropagation(); send(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  chatTiles.set(tile.id, { refresh });
  registerChat(tile.id);
  refresh();
}

// route Contex notifications: refresh chats on new messages; flag human attention
function handleContexNotification(n) {
  const method = n?.method || '';
  if (method.endsWith('message_received')) {
    for (const c of chatTiles.values()) c.refresh?.();
    refreshAllTimelines({ quiet: true });
  } else if (method.endsWith('agent_state_changed')) {
    applyTileState(n.params || {});
    refreshHumanAttention({ quiet: true });
    refreshStatusView({ quiet: true });
    refreshAllTimelines({ quiet: true });
  } else if (method.endsWith('human_attention')) {
    if (n.params?.tile_id) {
      upsertAttention(n.params);
      flashTile(n.params.tile_id);
    }
    refreshStatusView({ quiet: true });
    refreshHumanAttention({ quiet: true });
    refreshAllTimelines({ quiet: true });
    setStatus('⚠ agent needs attention' + (n.params?.text ? ': ' + n.params.text : ''), 'recovered');
  } else if (method.endsWith('objective_reload_required')) {
    if (n.params?.tile_id) flashTile(n.params.tile_id);
    refreshAllTimelines({ quiet: true });
    setStatus('⚠ objective reload required' + (n.params?.tile_id ? ': ' + n.params.tile_id : ''), 'recovered');
  } else if (method.endsWith('task_changed') || method.endsWith('task_transitioned') ||
             method.endsWith('file_claim_changed') || method.endsWith('claim_conflict') ||
             method.endsWith('polly_action_requested') || method.endsWith('polly_action_result')) {
    refreshStatusView({ quiet: true });
    refreshAllTimelines({ quiet: true });
    const tileId = n.params?.tile_id || n.params?.tileId || n.params?.owner_tile_id;
    if (tileId) flashTile(tileId);
    if (method.endsWith('claim_conflict')) {
      setStatus('⚠ file claim conflict' + (n.params?.path ? ': ' + n.params.path : ''), 'recovered');
    }
  }
}

// Remove ANSI CSI/OSC + lone escapes (interim until xterm.js renders them).
const ANSI_RE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><~]|\u001B[=>]/g;
function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

// ---- terminal tiles (M5) — xterm.js when available, <pre> fallback ----------
const terminalStreams = new Map(); // tileId -> EventSource
const terminalUIs = new Map();     // tileId -> screen controller

function closeStream(id) {
  const es = terminalStreams.get(id);
  if (es) { es.close(); terminalStreams.delete(id); }
}
function disposeTerminalUI(id) {
  terminalUIs.get(id)?.dispose?.();
  terminalUIs.delete(id);
}

window.__terminalUIs = terminalUIs; // exposed for the browser smoke harness

let _xterm; // { Terminal, FitAddon } | null  (loaded once)
async function loadXterm() {
  if (_xterm !== undefined) return _xterm;
  if (new URLSearchParams(location.search).get('xterm') === '0') { _xterm = null; return _xterm; } // tests force the <pre> fallback
  try {
    const [x, f] = await Promise.all([import('/vendor/xterm.mjs'), import('/vendor/addon-fit.mjs')]);
    _xterm = { Terminal: x.Terminal, FitAddon: f.FitAddon };
  } catch { _xterm = null; } // not installed → <pre> fallback
  return _xterm;
}

function openTerminalStream(tileId) {
  closeStream(tileId);
  terminalUIs.get(tileId)?.clear();
  const es = new EventSource(`/api/terminals/${tileId}/stream`);
  es.addEventListener('data', (e) => terminalUIs.get(tileId)?.write(JSON.parse(e.data).chunk));
  es.addEventListener('exit', (e) => terminalUIs.get(tileId)?.write(`\r\n[process exited: ${JSON.parse(e.data).code ?? ''}]\r\n`));
  es.onerror = () => { /* EventSource retries */ };
  terminalStreams.set(tileId, es);
}

async function wireTerminal(el, tile) {
  const screen = el.querySelector('.term-screen');
  const cmd = el.querySelector('.term-cmd');
  const startBtn = el.querySelector('.term-start');
  const stopBtn = el.querySelector('.term-stop');
  if (!screen) return;
  // keep canvas pan/drag/select from hijacking interactions inside the terminal
  el.querySelector('.term')?.addEventListener('mousedown', (e) => e.stopPropagation());

  disposeTerminalUI(tile.id); // drop any controller from a prior render of this tile
  const ui = await buildTerminalScreen(tile, screen);
  terminalUIs.set(tile.id, ui);

  async function startProcess() {
    const line = (cmd.value || '').trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    tile.data = { ...tile.data, command: line };
    scheduleSave();
    try {
      const current = await api('GET', `/api/terminals/${tile.id}`);
      if (current.status === 'running') {
        openTerminalStream(tile.id);
        ui.syncSize();
        return;
      }
      ui.clear();
      await api('POST', `/api/terminals/${tile.id}/start`, {
        command: tile.data.commandName || parts[0],
        args: Array.isArray(tile.data.args) ? tile.data.args : parts.slice(1),
        cwd: tile.data.cwd || app.repositoryPath,
        env: tile.data.env || {},
        cols: ui.cols(),
        rows: ui.rows(),
      });
      openTerminalStream(tile.id);
      ui.syncSize();
    } catch (err) {
      if (String(err.message || '').includes('terminal already running')) {
        openTerminalStream(tile.id);
        ui.syncSize();
        return;
      }
      ui.write(`\r\n[start failed: ${err.message}]\r\n`);
    }
  }

  startBtn.addEventListener('click', (e) => { e.stopPropagation(); startProcess(); });
  stopBtn.addEventListener('click', (e) => { e.stopPropagation(); api('POST', `/api/terminals/${tile.id}/stop`).catch(() => {}); });

  // reattach to a running process; else auto-start if an agent spawned this tile
  fetch(`/api/terminals/${tile.id}`).then((r) => r.json()).then((s) => {
    if (s.status === 'running' || (s.scrollback && s.scrollback.length)) { openTerminalStream(tile.id); return; }
    if (tile.data.autostart && tile.data.command) {
      cmd.value = tile.data.command;
      tile.data = { ...tile.data, autostart: false }; // one-shot
      scheduleSave();
      startProcess();
    }
  }).catch(() => {});
}

async function buildTerminalScreen(tile, screen) {
  const xterm = await loadXterm();
  const sendInput = (data) => api('POST', `/api/terminals/${tile.id}/input`, { data }).catch(() => {});
  const sendResize = (cols, rows) => api('POST', `/api/terminals/${tile.id}/resize`, { cols, rows }).catch(() => {});

  if (xterm) {
    screen.innerHTML = '';
    const term = new xterm.Terminal({
      fontSize: 12, fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      theme: { background: '#0c0e13', foreground: '#cfe3ff', cursor: '#4f9cff' },
      cursorBlink: true, scrollback: 4000, convertEol: true, // \n→\r\n so piped output also lays out
    });
    const fit = new xterm.FitAddon();
    term.loadAddon(fit);
    term.open(screen);
    const refit = () => { try { fit.fit(); } catch { /* not visible yet */ } };
    refit();
    term.onData(sendInput);
    term.onResize(({ cols, rows }) => sendResize(cols, rows));
    let rt;
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(refit, 80); });
    ro.observe(screen);
    return {
      kind: 'xterm', term,
      write: (c) => term.write(c),
      clear: () => term.clear(),
      cols: () => term.cols, rows: () => term.rows,
      syncSize: () => sendResize(term.cols, term.rows),
      dispose: () => { try { clearTimeout(rt); ro.disconnect(); term.dispose(); } catch { /* ignore */ } },
    };
  }

  // fallback: a plain <pre> (ANSI stripped) + a stdin line
  screen.innerHTML = '<pre class="term-out" tabindex="0"></pre><input class="term-input" placeholder="stdin — Enter to send" />';
  const out = screen.querySelector('.term-out');
  const input = screen.querySelector('.term-input');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); sendInput(input.value + '\n'); input.value = '';
  });
  return {
    kind: 'pre',
    write: (c) => { const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 4; out.textContent += stripAnsi(c); if (atBottom) out.scrollTop = out.scrollHeight; },
    clear: () => { out.textContent = ''; },
    cols: () => 80, rows: () => 24,
    syncSize: () => {},
    dispose: () => {},
  };
}

// ---- utils --------------------------------------------------------------
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---- boot ---------------------------------------------------------------
loadWorkspaces().catch((e) => setStatus('Load failed: ' + e.message, 'recovered'));
startContex();
