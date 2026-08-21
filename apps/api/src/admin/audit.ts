import { createId, now } from "../lib/ids";

export type AdminAuditInput = {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  outcome?: "success" | "failed";
};

export function adminAuditStatement(
  db: D1Database,
  input: AdminAuditInput,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO admin_audit_log (id, actor_user_id, action, target_type, target_id, reason, metadata_json, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      createId(),
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.reason ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.outcome ?? "success",
      now(),
    );
}
