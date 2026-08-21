ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN ban_reason TEXT;
ALTER TABLE user ADD COLUMN ban_expires INTEGER;
ALTER TABLE session ADD COLUMN impersonated_by TEXT;

CREATE INDEX IF NOT EXISTS user_role_idx ON user(role);
CREATE INDEX IF NOT EXISTS user_banned_idx ON user(banned);
CREATE INDEX IF NOT EXISTS generation_jobs_state_updated_idx ON generation_jobs(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type, target_id, created_at DESC);
