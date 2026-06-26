// -------- context attachments --------
// Pointers to context (files, URLs, snippets) attached to a tile. Contex stores
// metadata + a uri/hash, not inline content — get_context returns these as
// references so large attachments are fetched as resources, not inlined.

import { newAttachmentId } from '../ids.mjs';
import { nowIso, parseJson } from '../store.mjs';
import { err } from '../errors.mjs';

export function addAttachment(db, { tile_id, kind = 'file', label = null, uri = null, content_hash = null, metadata = null }, { clock } = {}) {
  if (!tile_id) throw err.badRequest('tile_id is required');
  const id = newAttachmentId();
  const ts = nowIso(clock);
  db.prepare(
    `INSERT INTO context_attachment (id, tile_id, kind, label, uri, content_hash, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tile_id, kind, label, uri, content_hash, metadata ? JSON.stringify(metadata) : null, ts, ts);
  return mapAttachment(db.prepare(`SELECT * FROM context_attachment WHERE id = ?`).get(id));
}

export function listAttachments(db, tileId) {
  return db.prepare(`SELECT * FROM context_attachment WHERE tile_id = ? ORDER BY created_at ASC`).all(tileId).map(mapAttachment);
}

function mapAttachment(r) {
  return { id: r.id, kind: r.kind, label: r.label, uri: r.uri, content_hash: r.content_hash, metadata: parseJson(r.metadata_json, null), created_at: r.created_at };
}
