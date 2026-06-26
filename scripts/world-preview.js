// ---- world-preview.js ----
// Shared isometric world preview renderer.
// Exposes window.TinyWorldPreview.renderPreview(canvas, preview).
// Lifted verbatim from engine/world/47-worlds-room.js; kept as a standalone
// IIFE so it adds only window.TinyWorldPreview to the global scope.
(function () {
  'use strict';

  function terrainColor(t) {
    return t === 'water' ? '#2f6fb0' : t === 'stone' ? '#7d8794' : t === 'sand' ? '#cdb98a'
      : t === 'dirt' ? '#7a5a3a' : t === 'path' ? '#b9a06a' : t === 'lava' ? '#c0431f' : t === 'snow' ? '#e6eef6' : '#3f8f53';
  }

  var PREVIEW_PLANTS = new Set(['crop', 'corn', 'wheat', 'pumpkin', 'carrot', 'sunflower']);
  var PREVIEW_ISO_KIND_COLORS = {
    tree: '#1f6f3a',
    bush: '#2f8b49',
    rock: '#9ba8ae',
    house: '#c76e46',
    fence: '#7a4b2c',
    cow: '#f0d8b8',
    sheep: '#f7f1dc',
    stargate: '#7fe6ff',
  };

  function previewShade(hex, amt) {
    var h = String(hex || '#000000').replace('#', '');
    var n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    var r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function previewCellTuple(c) {
    if (!c) return null;
    if (Array.isArray(c)) return { x: c[0], z: c[1], terrain: c[2] || 'grass', kind: c[3] || '' };
    return { x: c.x, z: c.z, terrain: c.terrain || 'grass', kind: c.kind || '' };
  }

  function drawPreviewDiamond(ctx, cx, cy, hw, hh, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawPreviewSide(ctx, cx, cy, hw, hh, depth, side, fill) {
    ctx.beginPath();
    if (side === 'right') {
      ctx.moveTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx + hw, cy + depth);
    } else {
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx - hw, cy + depth);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawPreviewObject(ctx, cx, cy, s, kind) {
    var k = PREVIEW_PLANTS.has(kind) ? 'plant' : kind;
    if (k === 'tree' || k === 'bush' || k === 'plant') {
      ctx.fillStyle = k === 'plant' ? '#d5df57' : PREVIEW_ISO_KIND_COLORS[k];
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.34, s * (k === 'tree' ? 0.22 : 0.16), 0, Math.PI * 2);
      ctx.fill();
      if (k === 'tree') {
        ctx.fillStyle = '#7b5434';
        ctx.fillRect(cx - s * 0.035, cy - s * 0.28, s * 0.07, s * 0.28);
      }
    } else if (k === 'rock') {
      ctx.fillStyle = PREVIEW_ISO_KIND_COLORS.rock;
      drawPreviewDiamond(ctx, cx, cy - s * 0.18, s * 0.16, s * 0.09, '#9ba8ae', '#65737b');
    } else if (k === 'house') {
      ctx.fillStyle = '#c76e46';
      ctx.fillRect(cx - s * 0.18, cy - s * 0.34, s * 0.36, s * 0.26);
      ctx.fillStyle = '#7b3340';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.22, cy - s * 0.34);
      ctx.lineTo(cx, cy - s * 0.56);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.34);
      ctx.closePath();
      ctx.fill();
    } else if (PREVIEW_ISO_KIND_COLORS[k]) {
      ctx.fillStyle = PREVIEW_ISO_KIND_COLORS[k];
      ctx.fillRect(cx - s * 0.08, cy - s * 0.28, s * 0.16, s * 0.16);
    }
  }

  function renderPreview(cnv, preview) {
    if (!cnv || !preview) return;
    var g = Math.max(1, preview.gridSize || 8);
    var suppliedList = Array.isArray(preview.cells) ? preview.cells : [];
    var list = suppliedList.map(previewCellTuple).filter(Boolean);
    var cssW = cnv.clientWidth || cnv.width || 320;
    var cssH = cnv.clientHeight || cnv.height || 200;
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cnv.width = Math.round(cssW * dpr); cnv.height = Math.round(cssH * dpr);
    var c2 = cnv.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, cssW, cssH);
    var bg = c2.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#070911');
    bg.addColorStop(1, '#030509');
    c2.fillStyle = bg;
    c2.fillRect(0, 0, cssW, cssH);
    c2.fillStyle = 'rgba(169,199,255,.22)';
    for (var i = 0; i < 26; i++) {
      var sx = (i * 47 + g * 13) % Math.max(1, cssW);
      var sy = (i * 31 + g * 7) % Math.max(1, cssH);
      c2.fillRect(sx, sy, 1, 1);
    }
    var map = new Map();
    for (var z = 0; z < g; z++) for (var x = 0; x < g; x++) map.set(x + ',' + z, { x: x, z: z, terrain: 'grass', kind: '' });
    for (var ci = 0; ci < list.length; ci++) {
      var cell = list[ci];
      var cx2 = Number(cell.x), cz2 = Number(cell.z);
      if (!Number.isFinite(cx2) || !Number.isFinite(cz2) || cx2 < 0 || cz2 < 0 || cx2 >= g || cz2 >= g) continue;
      map.set(cx2 + ',' + cz2, cell);
    }
    var tileW = Math.max(14, Math.min(30, cssW / (g + 2.4)));
    var tileH = tileW * 0.5;
    var depth = Math.max(8, tileH * 0.9);
    var originX = cssW * 0.5;
    var originY = Math.max(18, (cssH - (g * tileH + depth)) * 0.38);
    var sorted = Array.from(map.values()).sort(function (a, b) {
      return ((Number(a.x) + Number(a.z)) - (Number(b.x) + Number(b.z))) || (Number(a.z) - Number(b.z));
    });
    for (var si = 0; si < sorted.length; si++) {
      var sc = sorted[si];
      var sx2 = Number(sc.x), sz2 = Number(sc.z);
      var scx = originX + (sx2 - sz2) * tileW * 0.5;
      var scy = originY + (sx2 + sz2) * tileH * 0.5;
      var stop = terrainColor(sc.terrain);
      if (!map.has((sx2 + 1) + ',' + sz2)) drawPreviewSide(c2, scx, scy, tileW * 0.5, tileH * 0.5, depth, 'right', previewShade(stop, -62));
      if (!map.has(sx2 + ',' + (sz2 + 1))) drawPreviewSide(c2, scx, scy, tileW * 0.5, tileH * 0.5, depth, 'left', previewShade(stop, -42));
    }
    for (var di = 0; di < sorted.length; di++) {
      var dc = sorted[di];
      var dx = Number(dc.x), dz = Number(dc.z);
      var dcx = originX + (dx - dz) * tileW * 0.5;
      var dcy = originY + (dx + dz) * tileH * 0.5;
      var dtop = terrainColor(dc.terrain);
      drawPreviewDiamond(c2, dcx, dcy, tileW * 0.5, tileH * 0.5, dtop, 'rgba(3,5,9,.36)');
    }
    for (var oi = 0; oi < sorted.length; oi++) {
      var oc = sorted[oi];
      if (!oc.kind) continue;
      var ox = Number(oc.x), oz = Number(oc.z);
      var ocx = originX + (ox - oz) * tileW * 0.5;
      var ocy = originY + (ox + oz) * tileH * 0.5;
      drawPreviewObject(c2, ocx, ocy, tileW, oc.kind);
    }
  }

  window.TinyWorldPreview = { renderPreview: renderPreview };
})();
