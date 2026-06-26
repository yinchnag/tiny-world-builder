import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TileRegistry, createDefaultRegistry, normalizeTile, serializeTile, deserializeTile,
  safeRender, focusOrder, MIN_W, MIN_H,
} from '../public/tiles.mjs';

test('registry registers and resolves known types', () => {
  const reg = createDefaultRegistry();
  assert.ok(reg.has('terminal'));
  assert.equal(reg.get('terminal').label, 'Terminal');
  assert.deepEqual(reg.get('terminal').capabilities, ['terminal_input']);
  assert.ok(reg.list().length >= 5);
});

test('unknown type resolves to a non-throwing placeholder def', () => {
  const reg = createDefaultRegistry();
  const def = reg.get('hologram');
  assert.equal(def.unknown, true);
  assert.match(def.label, /Unknown \(hologram\)/);
  // its renderer must not throw and should mention the type
  const html = def.renderBody({ type: 'hologram', data: { a: 1 } });
  assert.match(html, /hologram/);
  assert.match(html, /preserved/);
});

test('normalizeTile fills defaults and clamps sizes to the minimum', () => {
  const reg = createDefaultRegistry();
  const t = normalizeTile({ type: 'note', w: 10, h: 5 }, reg); // below min
  assert.equal(t.w, MIN_W);
  assert.equal(t.h, MIN_H);
  assert.equal(t.status, 'idle');
  assert.equal(t.minimized, false);
  assert.match(t.id, /^tile_/);
  assert.equal(t.unknown, false);
});

test('normalizeTile uses the type default size when w/h absent', () => {
  const reg = createDefaultRegistry();
  const t = normalizeTile({ type: 'terminal' }, reg);
  assert.equal(t.w, 420);
  assert.equal(t.h, 300);
});

test('normalizeTile flags an unknown type but keeps it usable', () => {
  const reg = createDefaultRegistry();
  const t = normalizeTile({ type: 'quantum', x: 3, y: 4, data: { keep: 1 } }, reg);
  assert.equal(t.unknown, true);
  assert.equal(t.type, 'quantum');
  assert.deepEqual(t.data, { keep: 1 });
});

test('serialize → deserialize round-trips an unknown tile losslessly', () => {
  const reg = createDefaultRegistry();
  const original = { id: 'tile_z', type: 'futuretype', title: 'Mystery',
                     x: 12, y: 34, w: 300, h: 200, minimized: true, pinned: false,
                     status: 'working', data: { foo: 'bar', n: 7 } };
  const norm = deserializeTile(original, reg);
  assert.equal(norm.unknown, true);
  const persisted = serializeTile(norm);
  // type + data survive even with no renderer registered
  assert.equal(persisted.type, 'futuretype');
  assert.deepEqual(persisted.data, { foo: 'bar', n: 7 });
  assert.equal(persisted.minimized, true);
  // derived `unknown` flag is NOT persisted
  assert.equal('unknown' in persisted, false);
  // and re-normalizing yields the same shape again
  const again = deserializeTile(persisted, reg);
  assert.equal(again.unknown, true);
  assert.equal(again.title, 'Mystery');
});

test('serialize preserves position + size (resize persistence)', () => {
  const reg = createDefaultRegistry();
  const t = normalizeTile({ type: 'note', x: 50, y: 60, w: 400, h: 300 }, reg);
  const s = serializeTile(t);
  assert.deepEqual([s.x, s.y, s.w, s.h], [50, 60, 400, 300]);
});

test('safeRender catches a throwing renderer (crash isolation)', () => {
  const reg = new TileRegistry();
  reg.register({ type: 'bomb', renderBody: () => { throw new Error('boom'); } });
  const out = safeRender(reg.get('bomb'), { type: 'bomb', data: {} });
  assert.equal(out.ok, false);
  assert.match(out.html, /tile renderer failed/);
  assert.match(out.html, /boom/);
});

test('safeRender returns ok html for a healthy renderer', () => {
  const reg = createDefaultRegistry();
  const out = safeRender(reg.get('note'), { type: 'note', data: { note: 'hi <there>' } });
  assert.equal(out.ok, true);
  assert.match(out.html, /hi &lt;there&gt;/); // escaped
});

test('focusOrder is reading-order with pinned first', () => {
  const tiles = [
    { id: 'a', x: 100, y: 100, pinned: false },
    { id: 'b', x: 0, y: 0, pinned: false },
    { id: 'c', x: 50, y: 0, pinned: false },
    { id: 'p', x: 999, y: 999, pinned: true },
  ];
  // pinned p first, then by y then x: b(0,0), c(50,0), a(100,100)
  assert.deepEqual(focusOrder(tiles), ['p', 'b', 'c', 'a']);
});

test('registry.register rejects a def without a type', () => {
  const reg = new TileRegistry();
  assert.throws(() => reg.register({ label: 'no type' }), /string type/);
});
