// -------- workspace export / import / secret redaction --------
// Phase 9: portable export bundle, round-trip import, and sanitized diagnostics.
//
// exportWorkspace  — snapshot a workspace into a self-contained JSON bundle.
// importWorkspace  — restore a bundle into an existing db (same IDs; caller
//                    is responsible for ensuring no collision in a shared db).
// redactSecrets    — deep-scan an object and replace values whose keys match
//                    sensitive patterns with "[REDACTED]".

import { listAuditFeed } from '../store.mjs';

const SCHEMA = 'contex-export/1';

// Keys matching this pattern are redacted during export.
const SECRET_KEY_RE = /^(token|password|secret|api_key|apikey|authorization|bearer|auth|credential|private_key|access_key|client_secret)$/i;

// -------- export --------

export function exportWorkspace(db, workspaceId, { include_audit = true, audit_limit = 500 } = {}) {
  const workspace = db.prepare('SELECT * FROM workspace WHERE id = ?').get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const bundle = {
    schema: SCHEMA,
    exported_at: new Date().toISOString(),
    workspace: stripRow(workspace),
    tiles: db.prepare('SELECT * FROM tile WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    links: db.prepare('SELECT * FROM tile_link WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    messages: db.prepare('SELECT * FROM message WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    tasks: db.prepare('SELECT * FROM task WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    todos: db.prepare('SELECT * FROM todo WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    objectives: db.prepare(
      'SELECT ov.* FROM objective_version ov JOIN tile t ON t.id = ov.tile_id WHERE t.workspace_id = ?'
    ).all(workspaceId).map(stripRow),
    objective_acks: db.prepare(
      'SELECT oa.* FROM objective_ack oa JOIN tile t ON t.id = oa.tile_id WHERE t.workspace_id = ?'
    ).all(workspaceId).map(stripRow),
    skills: db.prepare(
      'SELECT sa.* FROM skill_assignment sa JOIN tile t ON t.id = sa.tile_id WHERE t.workspace_id = ?'
    ).all(workspaceId).map(stripRow),
    attachments: db.prepare(
      'SELECT ca.* FROM context_attachment ca JOIN tile t ON t.id = ca.tile_id WHERE t.workspace_id = ?'
    ).all(workspaceId).map(stripRow),
    claims: db.prepare('SELECT * FROM file_claim WHERE workspace_id = ?').all(workspaceId).map(stripRow),
    audit_events: include_audit ? listAuditFeed(db, workspaceId, { since_sequence: 0, limit: audit_limit }) : [],
  };

  return redactSecrets(bundle);
}

// -------- import --------

export function importWorkspace(db, bundle) {
  if (bundle?.schema !== SCHEMA) throw new Error(`Unsupported export schema: ${bundle?.schema}`);

  const ws = bundle.workspace;
  db.prepare(
    `INSERT OR IGNORE INTO workspace (id, name, repository_path, created_at, updated_at, archived_at, revision, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ws.id, ws.name, ws.repository_path ?? null, ws.created_at, ws.updated_at, ws.archived_at ?? null, ws.revision ?? 0, ws.settings_json ?? null);

  for (const r of bundle.tiles ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO tile
         (id, workspace_id, type, title, display_name, status, task, progress, summary, blocker, branch,
          worktree, client_instance_id, capabilities_json, version, last_seen_at, created_at, updated_at, closed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.type, r.title ?? null, r.display_name ?? null, r.status, r.task ?? null, r.progress ?? null, r.summary ?? null, r.blocker ?? null, r.branch ?? null, r.worktree ?? null, r.client_instance_id ?? null, r.capabilities_json ?? null, r.version ?? 1, r.last_seen_at ?? null, r.created_at, r.updated_at, r.closed_at ?? null);
  }

  for (const r of bundle.links ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO tile_link (id, workspace_id, source_tile_id, target_tile_id, kind, directed, metadata_json, created_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.source_tile_id, r.target_tile_id, r.kind ?? 'collaborates_with', r.directed ?? 0, r.metadata_json ?? null, r.created_at, r.deleted_at ?? null);
  }

  for (const r of bundle.messages ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO message
         (id, workspace_id, from_tile_id, to_tile_id, channel, reply_to_id, priority, text, metadata_json,
          requires_ack, created_at, delivered_at, read_at, acknowledged_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.from_tile_id ?? null, r.to_tile_id ?? null, r.channel ?? null, r.reply_to_id ?? null, r.priority ?? 'normal', r.text, r.metadata_json ?? null, r.requires_ack ?? 0, r.created_at, r.delivered_at ?? null, r.read_at ?? null, r.acknowledged_at ?? null, r.expires_at ?? null);
  }

  for (const r of bundle.tasks ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO task
         (id, workspace_id, channel, title, description, status, priority, owner_tile_id, creator_tile_id,
          blocker, result_summary, version, created_at, updated_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.channel ?? null, r.title, r.description ?? null, r.status ?? 'open', r.priority ?? 'normal', r.owner_tile_id ?? null, r.creator_tile_id ?? null, r.blocker ?? null, r.result_summary ?? null, r.version ?? 1, r.created_at, r.updated_at, r.completed_at ?? null);
  }

  for (const r of bundle.todos ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO todo
         (id, workspace_id, creator_tile_id, assignee_tile_id, title, description, status, priority, due_at, created_at, completed_at, result_summary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.creator_tile_id ?? null, r.assignee_tile_id ?? null, r.title, r.description ?? null, r.status ?? 'open', r.priority ?? 'normal', r.due_at ?? null, r.created_at, r.completed_at ?? null, r.result_summary ?? null);
  }

  for (const r of bundle.objectives ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO objective_version (id, workspace_id, tile_id, version, markdown, rules_json, generated_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id ?? null, r.tile_id, r.version, r.markdown ?? null, r.rules_json ?? null, r.generated_by ?? null, r.created_at);
  }

  for (const r of bundle.objective_acks ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO objective_ack (tile_id, version, acknowledged_at) VALUES (?,?,?)`
    ).run(r.tile_id, r.version, r.acknowledged_at);
  }

  for (const r of bundle.skills ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO skill_assignment (id, tile_id, skill_key, source, enabled, metadata_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(r.id, r.tile_id, r.skill_key, r.source ?? null, r.enabled ?? 1, r.metadata_json ?? null, r.created_at, r.updated_at);
  }

  for (const r of bundle.attachments ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO context_attachment (id, tile_id, kind, label, uri, content_hash, metadata_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.tile_id, r.kind ?? null, r.label ?? null, r.uri ?? null, r.content_hash ?? null, r.metadata_json ?? null, r.created_at, r.updated_at);
  }

  for (const r of bundle.claims ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO file_claim (id, workspace_id, tile_id, path, mode, section, created_at, refreshed_at, expires_at, released_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(r.id, r.workspace_id, r.tile_id, r.path, r.mode, r.section ?? null, r.created_at, r.refreshed_at ?? null, r.expires_at ?? null, r.released_at ?? null);
  }

  return { workspace_id: ws.id, imported_at: new Date().toISOString() };
}

// -------- secret redaction --------

export function redactSecrets(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redactSecrets(v);
  }
  return out;
}

// -------- helpers --------

// Strip SQLite row-level cruft (no transformation needed — rows are plain objects).
function stripRow(row) { return { ...row }; }