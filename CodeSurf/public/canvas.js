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
const statusEl = $('#status');
const wsSelect = $('#workspace-select');
const minimap = $('#minimap');

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

// ---- API ----------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error?.message || res.statusText);
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
  renderMinimap();
}

// ---- rendering ----------------------------------------------------------
function renderAll() {
  // remove existing tile nodes (keep the persistent <svg id="links">)
  world.querySelectorAll('.tile').forEach((n) => n.remove());
  for (const t of tiles()) {
    // element-level crash isolation: a broken tile must not abort the whole render
    try { world.appendChild(makeTileEl(t)); }
    catch (err) { world.appendChild(errorTileEl(t, err)); }
  }
  renderLinks();
  applyViewport();
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
    <div class="head">
      <span class="dot status-${escapeHtml(t.status || 'idle')}" title="${escapeHtml(t.status || 'idle')}"></span>
      <span class="type">${escapeHtml(def.label)}</span>
      <span class="title">${escapeHtml(t.title || def.label)}</span>
      <button class="btn pin" title="Pin (lock position)">${t.pinned ? '📌' : '📍'}</button>
      <button class="btn min" title="${t.minimized ? 'Expand' : 'Minimize'}">${t.minimized ? '▢' : '▁'}</button>
      <button class="btn close" title="Delete tile">×</button>
    </div>
    <div class="body${body.ok ? '' : ' has-error'}">${body.html}</div>
    <div class="port" title="Drag to another tile to link"></div>
    <div class="resize" title="Resize"></div>`;
  if (def.type === 'terminal') wireTerminal(el, t);
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

function renderLinks() {
  // keep only the temp-drag path, rebuild persistent links
  linksSvg.querySelectorAll('path:not(.temp)').forEach((n) => n.remove());
  for (const l of links()) {
    const s = tileById(l.source), d = tileById(l.target);
    if (!s || !d) continue;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', linkPath(portPoint(s, 'out'), portPoint(d, 'in')));
    p.dataset.linkId = l.id;
    linksSvg.appendChild(p);
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
  const removedLinks = links().filter((l) => l.source === id || l.target === id);
  app.layout.tiles = tiles().filter((t) => t.id !== id);
  app.layout.links = links().filter((l) => l.source !== id && l.target !== id);
  world.querySelector(`.tile[data-id="${id}"]`)?.remove();
  if (app.selectedId === id) app.selectedId = null;
  renderLinks(); renderMinimap(); scheduleSave();
  for (const l of removedLinks) contexMirrorLink('DELETE', l.source, l.target);
  closeStream(id);
  api('POST', `/api/terminals/${id}/stop`).catch(() => {}); // stop any process the tile owned
}

function addLink(source, target) {
  if (source === target) return;
  if (links().some((l) => l.source === source && l.target === target)) return;
  links().push({ id: 'link_' + crypto.randomUUID().replace(/-/g, ''), source, target, directed: true });
  renderLinks(); scheduleSave();
  contexMirrorLink('POST', source, target, true); // mirror to Contex peer graph (best-effort)
}

// ---- autosave -----------------------------------------------------------
let saveTimer = null;
let dirty = false;
function scheduleSave() {
  if (!app.workspaceId) return;
  dirty = true;
  setStatus('Saving…', 'saving');
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
    setStatus(`Saved ${t.toLocaleTimeString()}`);
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'recovered');
  }
}
function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- interactions: pan / zoom ------------------------------------------
let drag = null; // active gesture descriptor

canvas.addEventListener('mousedown', (e) => {
  const tileEl = e.target.closest('.tile');
  if (e.target.classList.contains('port')) {
    return startLinkDrag(tileEl.dataset.id, e);
  }
  if (e.target.classList.contains('resize')) {
    return startResize(tileEl.dataset.id, e);
  }
  if (e.target.classList.contains('close')) {
    return deleteTile(tileEl.dataset.id);
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

canvas.addEventListener('dblclick', (e) => {
  if (e.target.closest('.tile')) return;
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
    const overTile = e.target.closest('.tile');
    if (overTile) addLink(drag.source, overTile.dataset.id);
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
  if (e.target.tagName === 'INPUT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedId) { e.preventDefault(); deleteTile(app.selectedId); }
  else if (e.key === 'f') zoomToFit();
  else if (e.key === 'Escape' && drag?.kind === 'link') { drag.tempPath.remove(); drag = null; }
  else if (e.key === 'Tab') { e.preventDefault(); focusNextTile(e.shiftKey ? -1 : 1); }
});

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
  const r = visibleWorldRect();
  addTile(r.x + r.w / 2 - 110, r.y + r.h / 2 - 70);
});
$('#fit').addEventListener('click', zoomToFit);
$('#reset-zoom').addEventListener('click', () => {
  vp().zoom = 1; applyViewport(); scheduleSave();
});

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
  setStatus(recovered ? 'Recovered from backup' : `Opened ${meta.name}`, recovered ? 'recovered' : '');
}

wsSelect.addEventListener('change', () => openWorkspace(wsSelect.value));

// ---- new-workspace dialog ----------------------------------------------
const newDialog = $('#new-dialog');
$('#new-workspace').addEventListener('click', openNewDialog);
function openNewDialog() { $('#nw-error').textContent = ''; newDialog.showModal(); }
newDialog.addEventListener('close', async () => {
  if (newDialog.returnValue !== 'create') return;
  const name = $('#nw-name').value.trim();
  const repositoryPath = $('#nw-repo').value.trim();
  try {
    const meta = await api('POST', '/api/workspaces', { name, repositoryPath });
    $('#nw-name').value = ''; $('#nw-repo').value = '';
    await loadWorkspaces(meta.id);
  } catch (e) {
    $('#nw-error').textContent = e.message;
    openNewDialog();
  }
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
let contexConnected = false;

function setContexStatus(status) {
  contexConnected = status === 'connected';
  contexPill.textContent = 'Contex: ' + status;
  contexPill.className = 'contex ' + status;
}

async function contexMirrorLink(method, source, target, directed) {
  if (!contexConnected) return; // no backend → skip the mirror (avoids 503 noise)
  try {
    await fetch('/api/contex/links', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, target, directed }),
    });
  } catch { /* Contex offline — canvas link still stands; best-effort mirror */ }
}

// drive a tile's status dot from a Contex tile_state_changed notification
function applyTileState(params) {
  if (!params || !params.tile_id) return;
  const t = tileById(params.tile_id);
  if (!t || !params.status) return;
  t.status = params.status;
  const dot = world.querySelector(`.tile[data-id="${params.tile_id}"] .head .dot`);
  if (dot) { dot.className = 'dot status-' + params.status; dot.title = params.status; }
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
      if (p.title) { t.title = p.title; replaceTileEl(t); }
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

// ---- terminal tiles (M5) ------------------------------------------------
const terminalStreams = new Map(); // tileId -> EventSource

function closeStream(id) {
  const es = terminalStreams.get(id);
  if (es) { es.close(); terminalStreams.delete(id); }
}

function wireTerminal(el, tile) {
  const out = el.querySelector('.term-out');
  const cmd = el.querySelector('.term-cmd');
  const input = el.querySelector('.term-input');
  const startBtn = el.querySelector('.term-start');
  const stopBtn = el.querySelector('.term-stop');
  if (!out) return;

  // keep canvas pan/drag/select from hijacking interactions inside the terminal
  el.querySelector('.term')?.addEventListener('mousedown', (e) => e.stopPropagation());

  const append = (chunk) => {
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 4;
    out.textContent += chunk;
    if (atBottom) out.scrollTop = out.scrollHeight;
  };
  function openStream() {
    closeStream(tile.id);
    out.textContent = '';
    const es = new EventSource(`/api/terminals/${tile.id}/stream`);
    es.addEventListener('data', (e) => append(JSON.parse(e.data).chunk));
    es.addEventListener('exit', (e) => append(`\n[process exited: ${JSON.parse(e.data).code ?? ''}]\n`));
    es.onerror = () => { /* EventSource retries */ };
    terminalStreams.set(tile.id, es);
  }

  startBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const line = (cmd.value || '').trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    tile.data = { ...tile.data, command: line };
    scheduleSave();
    try {
      await api('POST', `/api/terminals/${tile.id}/start`, { command: parts[0], args: parts.slice(1), cwd: app.repositoryPath });
      openStream();
    } catch (err) { append(`\n[start failed: ${err.message}]\n`); }
  });
  stopBtn.addEventListener('click', (e) => { e.stopPropagation(); api('POST', `/api/terminals/${tile.id}/stop`).catch(() => {}); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    api('POST', `/api/terminals/${tile.id}/input`, { data: input.value + '\n' }).catch(() => {});
    input.value = '';
  });

  // reattach to an already-running process (re-render / page reload)
  fetch(`/api/terminals/${tile.id}`).then((r) => r.json()).then((s) => {
    if (s.status === 'running' || (s.scrollback && s.scrollback.length)) openStream();
  }).catch(() => {});
}

// ---- utils --------------------------------------------------------------
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---- boot ---------------------------------------------------------------
loadWorkspaces().catch((e) => setStatus('Load failed: ' + e.message, 'recovered'));
startContex();
