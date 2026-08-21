CREATE TABLE admin_audit_log_next (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failed')),
  created_at INTEGER NOT NULL
);

INSERT INTO admin_audit_log_next (
  id, actor_user_id, action, target_type, target_id, reason, metadata_json, outcome, created_at
)
SELECT
  id, actor_user_id, action, target_type, target_id, reason, metadata_json, outcome, created_at
FROM admin_audit_log;

DROP TABLE admin_audit_log;
ALTER TABLE admin_audit_log_next RENAME TO admin_audit_log;

CREATE INDEX admin_audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX admin_audit_actor_idx ON admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit_log(target_type, target_id, created_at DESC);
