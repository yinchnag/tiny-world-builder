// -------- sqlite connection + schema --------
// Local-first storage per DATA_MODEL.md: one SQLite database per installation,
// WAL mode for concurrent readers, foreign keys on, append-only audit events
// alongside normalized current-state tables.
//
// Uses the built-in `node:sqlite` (Node >= 22.5, run with --experimental-sqlite)
// so the package keeps ZERO runtime dependencies, matching the repo's
// no-npm-runtime-deps convention.

import { DatabaseSync } from 'node:sqlite';

// Bumped whenever SCHEMA changes; stored in PRAGMA user_version so an existing
// db can be detected as current. Round 1 ships v1.
const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  repository_path TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  archived_at     TEXT,
  revision        INTEGER NOT NULL DEFAULT 0,
  settings_json   TEXT
);

CREATE TABLE IF NOT EXISTS tile (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspace(id),
  type               TEXT NOT NULL,
  title              TEXT,
  display_name       TEXT,
  status             TEXT NOT NULL,
  task               TEXT,
  progress           TEXT,
  summary            TEXT,
  blocker            TEXT,
  branch             TEXT,
  worktree           TEXT,
  client_instance_id TEXT,
  capabilities_json  TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  last_seen_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  closed_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_tile_workspace ON tile(workspace_id);

CREATE TABLE IF NOT EXISTS tile_link (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspace(id),
  source_tile_id TEXT NOT NULL,
  target_tile_id TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'collaborates_with',
  directed       INTEGER NOT NULL DEFAULT 0,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_link_workspace ON tile_link(workspace_id);
CREATE INDEX IF NOT EXISTS idx_link_source ON tile_link(source_tile_id);
CREATE INDEX IF NOT EXISTS idx_link_target ON tile_link(target_tile_id);

CREATE TABLE IF NOT EXISTS file_claim (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  tile_id      TEXT NOT NULL,
  path         TEXT NOT NULL,
  mode         TEXT NOT NULL,
  section      TEXT,
  created_at   TEXT NOT NULL,
  refreshed_at TEXT,
  expires_at   TEXT,
  released_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_claim_workspace ON file_claim(workspace_id);
CREATE INDEX IF NOT EXISTS idx_claim_tile ON file_claim(tile_id);
CREATE INDEX IF NOT EXISTS idx_claim_path ON file_claim(path);

CREATE TABLE IF NOT EXISTS message (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  from_tile_id    TEXT,
  to_tile_id      TEXT,
  channel         TEXT,
  reply_to_id     TEXT,
  priority        TEXT NOT NULL DEFAULT 'normal',
  text            TEXT NOT NULL,
  metadata_json   TEXT,
  requires_ack    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT,
  read_at         TEXT,
  acknowledged_at TEXT,
  expires_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_message_to ON message(to_tile_id);

CREATE TABLE IF NOT EXISTS task (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  channel         TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  priority        TEXT NOT NULL DEFAULT 'normal',
  owner_tile_id   TEXT,
  creator_tile_id TEXT,
  blocker         TEXT,
  result_summary  TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_workspace ON task(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_channel ON task(channel);

CREATE TABLE IF NOT EXISTS todo (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspace(id),
  creator_tile_id  TEXT,
  assignee_tile_id TEXT,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  priority         TEXT NOT NULL DEFAULT 'normal',
  due_at           TEXT,
  created_at       TEXT NOT NULL,
  completed_at     TEXT,
  result_summary   TEXT
);
CREATE INDEX IF NOT EXISTS idx_todo_assignee ON todo(assignee_tile_id);

CREATE TABLE IF NOT EXISTS objective_version (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,
  tile_id      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  markdown     TEXT,
  rules_json   TEXT,
  generated_by TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objective_tile ON objective_version(tile_id);

-- one row per tile recording the highest objective version it has acknowledged
CREATE TABLE IF NOT EXISTS objective_ack (
  tile_id         TEXT PRIMARY KEY,
  version         INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_assignment (
  id            TEXT PRIMARY KEY,
  tile_id       TEXT NOT NULL,
  skill_key     TEXT NOT NULL,
  source        TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_tile_key ON skill_assignment(tile_id, skill_key);

CREATE TABLE IF NOT EXISTS context_attachment (
  id            TEXT PRIMARY KEY,
  tile_id       TEXT NOT NULL,
  kind          TEXT,
  label         TEXT,
  uri           TEXT,
  content_hash  TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachment_tile ON context_attachment(tile_id);

CREATE TABLE IF NOT EXISTS audit_event (
  sequence      INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT,
  actor_type    TEXT,
  actor_id      TEXT,
  tile_id       TEXT,
  event_type    TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  correlation_id TEXT,
  payload_json  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_event(workspace_id);

-- Idempotency cache: a mutating tool called twice with the same key returns the
-- first stored response instead of re-applying. Round 1 stores responses for
-- peer_set_state / peer_send_message / peer_add_todo.
CREATE TABLE IF NOT EXISTS idempotency (
  key           TEXT PRIMARY KEY,
  tool          TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

export function schemaVersion() {
  return SCHEMA_VERSION;
}
