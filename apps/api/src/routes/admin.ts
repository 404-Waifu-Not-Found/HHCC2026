import {
  AdminAuditResponseSchema,
  AdminGenerationStateSchema,
  AdminGenerationsResponseSchema,
  AdminJobsResponseSchema,
  AdminLessonsResponseSchema,
  AdminMeResponseSchema,
  AdminMutationResponseSchema,
  AdminOverviewResponseSchema,
  AdminReasonRequestSchema,
  AdminRoleSchema,
  AdminSetRoleRequestSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  type AdminRole,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { permissionsForRole } from "../admin/access";
import { adminAuditStatement } from "../admin/audit";
import {
  readAdminGenerationCounts,
  readAdminGenerationPage,
  readLatestAppliedMigration,
  readRecentGenerationFailures,
} from "../admin/generations";
import { ApiError } from "../lib/errors";
import { quizGenerationRolloutMode } from "../lib/generation-rollout";
import { now } from "../lib/ids";
import { parseJson } from "../lib/validation";
import { publicWorkerVersion } from "../lib/worker-version";
import { requireAdminPermission } from "../middleware/admin";
import type { ApiBindings } from "../middleware/authenticated";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).default(""),
});

const UserListQuerySchema = ListQuerySchema.extend({
  role: AdminRoleSchema.optional(),
  status: z.enum(["active", "banned"]).optional(),
});

const AuditListQuerySchema = ListQuerySchema.extend({
  outcome: z.enum(["success", "failed"]).optional(),
});

const GenerationListQuerySchema = ListQuerySchema.extend({
  state: AdminGenerationStateSchema.optional(),
  stalled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

type CountRow = { count: number };
type UserRow = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  banned: number;
  ban_reason: string | null;
  ban_expires: number | null;
  email_verified: number;
  created_at: number;
  last_seen_at: number | null;
  lesson_count: number;
  attempt_count: number;
};

export const adminRouter = new Hono<ApiBindings>();

adminRouter.get("/me", requireAdminPermission("overview:read"), (c) => {
  const user = c.get("user");
  return c.json(
    AdminMeResponseSchema.parse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      permissions: permissionsForRole(user.role),
    }),
  );
});

adminRouter.get(
  "/overview",
  requireAdminPermission("overview:read"),
  async (c) => {
    const weekAgo = now() - 7 * 24 * 60 * 60 * 1_000;
    const [
      users,
      lessons,
      newUsers,
      lessons7d,
      attempts7d,
      generationCounts,
      recentFailures,
    ] = await Promise.all([
      count(c.env.DB, "SELECT COUNT(*) AS count FROM user"),
      count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM quiz_banks q JOIN videos v ON v.id = q.video_id WHERE v.source = 'youtube'",
      ),
      count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM user WHERE created_at >= ?",
        [weekAgo],
      ),
      count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM quiz_banks q JOIN videos v ON v.id = q.video_id WHERE v.source = 'youtube' AND q.created_at >= ?",
        [weekAgo],
      ),
      count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM attempts a JOIN quiz_banks q ON q.id = a.quiz_id JOIN videos v ON v.id = q.video_id WHERE v.source = 'youtube' AND a.status = 'complete' AND a.completed_at >= ?",
        [weekAgo],
      ),
      readAdminGenerationCounts(c.env.DB),
      readRecentGenerationFailures(c.env.DB),
    ]);

    return c.json(
      AdminOverviewResponseSchema.parse({
        totals: {
          users,
          lessons,
          activeJobs: generationCounts.generating + generationCounts.retrying,
          failedJobs: generationCounts.retryRequired,
        },
        activity: {
          newUsers7d: newUsers,
          lessons7d,
          completedAttempts7d: attempts7d,
        },
        recentFailures,
      }),
    );
  },
);

adminRouter.get("/users", requireAdminPermission("users:read"), async (c) => {
  const query = parseListQuery(c.req.query(), UserListQuerySchema);
  const where: string[] = [];
  const values: unknown[] = [];
  if (query.search) {
    where.push("(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)");
    const pattern = `%${query.search}%`;
    values.push(pattern, pattern, pattern);
  }
  if (query.role) {
    where.push("u.role = ?");
    values.push(query.role);
  }
  if (query.status) {
    where.push("u.banned = ?");
    values.push(query.status === "banned" ? 1 : 0);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS count FROM user u ${clause}`,
    values,
  );
  const offset = (query.page - 1) * query.pageSize;
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.username, u.role, u.banned, u.ban_reason, u.ban_expires, u.email_verified, u.created_at,
      (SELECT MAX(s.updated_at) FROM session s WHERE s.user_id = u.id) AS last_seen_at,
      (SELECT COUNT(*) FROM quiz_banks q JOIN videos v ON v.id = q.video_id WHERE q.user_id = u.id AND v.source = 'youtube') AS lesson_count,
      (SELECT COUNT(*) FROM attempts a JOIN quiz_banks q ON q.id = a.quiz_id JOIN videos v ON v.id = q.video_id WHERE a.user_id = u.id AND v.source = 'youtube') AS attempt_count
      FROM user u ${clause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...values, query.pageSize, offset)
    .all<UserRow>();

  return c.json(
    AdminUsersResponseSchema.parse({
      users: rows.results.map(mapUser),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    }),
  );
});

adminRouter.post(
  "/users/:userId/ban",
  requireAdminPermission("users:moderate"),
  async (c) => {
    const actor = c.get("user");
    const target = await getManagedUser(c.env.DB, c.req.param("userId"));
    const input = await parseJson(c, AdminReasonRequestSchema);
    assertCanModerate(actor.id, actor.role, target);
    if (target.role === "owner") {
      const activeOwnerCount = await count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM user WHERE role = 'owner' AND banned = 0",
      );
      if (activeOwnerCount <= 1) {
        throw new ApiError(
          409,
          "last_owner_protected",
          "ClipQuest must always retain at least one active owner.",
        );
      }
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE user SET banned = 1, ban_reason = ?, ban_expires = NULL, updated_at = ? WHERE id = ?",
      ).bind(input.reason, now(), target.id),
      c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(target.id),
      adminAuditStatement(c.env.DB, {
        actorUserId: actor.id,
        action: "user.ban",
        targetType: "user",
        targetId: target.id,
        reason: input.reason,
        metadata: { previousRole: target.role },
      }),
    ]);
    return c.json(AdminMutationResponseSchema.parse({ ok: true }));
  },
);

adminRouter.post(
  "/users/:userId/unban",
  requireAdminPermission("users:moderate"),
  async (c) => {
    const actor = c.get("user");
    const target = await getManagedUser(c.env.DB, c.req.param("userId"));
    const input = await parseJson(c, AdminReasonRequestSchema);
    assertCanModerate(actor.id, actor.role, target);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE user SET banned = 0, ban_reason = NULL, ban_expires = NULL, updated_at = ? WHERE id = ?",
      ).bind(now(), target.id),
      adminAuditStatement(c.env.DB, {
        actorUserId: actor.id,
        action: "user.unban",
        targetType: "user",
        targetId: target.id,
        reason: input.reason,
      }),
    ]);
    return c.json(AdminMutationResponseSchema.parse({ ok: true }));
  },
);

adminRouter.post(
  "/users/:userId/revoke-sessions",
  requireAdminPermission("users:moderate"),
  async (c) => {
    const actor = c.get("user");
    const target = await getManagedUser(c.env.DB, c.req.param("userId"));
    const input = await parseJson(c, AdminReasonRequestSchema);
    assertCanModerate(actor.id, actor.role, target);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(target.id),
      adminAuditStatement(c.env.DB, {
        actorUserId: actor.id,
        action: "user.revoke_sessions",
        targetType: "user",
        targetId: target.id,
        reason: input.reason,
      }),
    ]);
    return c.json(AdminMutationResponseSchema.parse({ ok: true }));
  },
);

adminRouter.post(
  "/users/:userId/role",
  requireAdminPermission("users:set-role"),
  async (c) => {
    const actor = c.get("user");
    const target = await getManagedUser(c.env.DB, c.req.param("userId"));
    const input = await parseJson(c, AdminSetRoleRequestSchema);
    if (target.id === actor.id) {
      throw new ApiError(
        409,
        "self_role_change_forbidden",
        "You cannot change your own operations role.",
      );
    }
    if (target.role === "owner" && input.role !== "owner") {
      const ownerCount = await count(
        c.env.DB,
        "SELECT COUNT(*) AS count FROM user WHERE role = 'owner' AND banned = 0",
      );
      if (ownerCount <= 1) {
        throw new ApiError(
          409,
          "last_owner_protected",
          "ClipQuest must always retain at least one owner.",
        );
      }
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE user SET role = ?, updated_at = ? WHERE id = ?",
      ).bind(input.role, now(), target.id),
      adminAuditStatement(c.env.DB, {
        actorUserId: actor.id,
        action: "user.set_role",
        targetType: "user",
        targetId: target.id,
        reason: input.reason,
        metadata: { previousRole: target.role, nextRole: input.role },
      }),
    ]);
    return c.json(AdminMutationResponseSchema.parse({ ok: true }));
  },
);

adminRouter.get(
  "/generations",
  requireAdminPermission("jobs:read"),
  async (c) => {
    const query = parseListQuery(c.req.query(), GenerationListQuerySchema);
    const result = await readAdminGenerationPage(c.env.DB, query);
    return c.json(
      AdminGenerationsResponseSchema.parse({
        generations: result.generations,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
        },
      }),
    );
  },
);

// One-release compatibility endpoint for stale shells and bookmarks. Backend
// generation jobs no longer exist; local extension streams are exposed above.
adminRouter.get("/jobs", requireAdminPermission("jobs:read"), (c) => {
  const query = parseListQuery(c.req.query(), ListQuerySchema);
  return c.json(
    AdminJobsResponseSchema.parse({
      jobs: [],
      pagination: { page: query.page, pageSize: query.pageSize, total: 0 },
    }),
  );
});

adminRouter.get(
  "/lessons",
  requireAdminPermission("lessons:read"),
  async (c) => {
    const query = parseListQuery(c.req.query(), ListQuerySchema);
    const values: unknown[] = [];
    const where = ["v.source = 'youtube'"];
    if (query.search) {
      where.push("(v.title LIKE ? OR u.email LIKE ? OR q.id LIKE ?)");
      const pattern = `%${query.search}%`;
      values.push(pattern, pattern, pattern);
    }
    const clause = `WHERE ${where.join(" AND ")}`;
    const total = await count(
      c.env.DB,
      `SELECT COUNT(*) AS count FROM quiz_banks q JOIN videos v ON v.id = q.video_id JOIN user u ON u.id = q.user_id ${clause}`,
      values,
    );
    const rows = await c.env.DB.prepare(
      `SELECT q.id, q.language, q.session_length, q.watched, q.created_at,
      (SELECT COUNT(*) FROM questions questions WHERE questions.quiz_id = q.id) AS question_count,
      (SELECT COUNT(*) FROM attempts attempts WHERE attempts.quiz_id = q.id) AS attempt_count,
      u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
      v.id AS video_id, v.title AS video_title, v.source AS video_source
      FROM quiz_banks q JOIN videos v ON v.id = q.video_id JOIN user u ON u.id = q.user_id
      ${clause} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...values, query.pageSize, (query.page - 1) * query.pageSize)
      .all<Record<string, string | number | null>>();
    return c.json(
      AdminLessonsResponseSchema.parse({
        lessons: rows.results.map((row) => ({
          id: row.id,
          language: row.language,
          sessionLength: row.session_length,
          watched: Boolean(row.watched),
          createdAt: toIso(row.created_at as number),
          questionCount: Number(row.question_count),
          attemptCount: Number(row.attempt_count),
          owner: {
            id: row.owner_id,
            name: row.owner_name,
            email: row.owner_email,
          },
          video: {
            id: row.video_id,
            title: row.video_title,
            source: row.video_source,
          },
        })),
        pagination: { page: query.page, pageSize: query.pageSize, total },
      }),
    );
  },
);

adminRouter.get("/audit", requireAdminPermission("audit:read"), async (c) => {
  const query = parseListQuery(c.req.query(), AuditListQuerySchema);
  const where: string[] = [];
  const values: unknown[] = [];
  if (query.search) {
    where.push("(a.action LIKE ? OR u.email LIKE ? OR a.target_id LIKE ?)");
    const pattern = `%${query.search}%`;
    values.push(pattern, pattern, pattern);
  }
  if (query.outcome) {
    where.push("a.outcome = ?");
    values.push(query.outcome);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS count FROM admin_audit_log a LEFT JOIN user u ON u.id = a.actor_user_id ${clause}`,
    values,
  );
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.reason, a.metadata_json, a.outcome, a.created_at,
      COALESCE(u.id, 'deleted-operator') AS actor_id,
      COALESCE(u.name, 'Deleted operator') AS actor_name,
      COALESCE(u.email, 'deleted-operator@clipquest.invalid') AS actor_email
      FROM admin_audit_log a LEFT JOIN user u ON u.id = a.actor_user_id ${clause}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...values, query.pageSize, (query.page - 1) * query.pageSize)
    .all<Record<string, string | number | null>>();
  return c.json(
    AdminAuditResponseSchema.parse({
      entries: rows.results.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        outcome: row.outcome,
        metadata: safeMetadata(row.metadata_json),
        createdAt: toIso(row.created_at as number),
        actor: {
          id: row.actor_id,
          name: row.actor_name,
          email: row.actor_email,
        },
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    }),
  );
});

adminRouter.get("/system", requireAdminPermission("system:read"), async (c) => {
  const [generationCounts, migration] = await Promise.all([
    readAdminGenerationCounts(c.env.DB),
    readLatestAppliedMigration(c.env.DB),
  ]);
  const jobs = {
    queued: 0,
    running: generationCounts.generating + generationCounts.retrying,
    complete: generationCounts.ready,
    failed: generationCounts.retryRequired,
  };
  return c.json(
    AdminSystemResponseSchema.parse({
      configuration: {
        authentication: Boolean(c.env.BETTER_AUTH_SECRET),
        generation: true,
        email: Boolean(c.env.RESEND_API_KEY),
        youtubeEncryption: Boolean(c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY),
        youtubeDemoHistory: c.env.ENABLE_YOUTUBE_DEMO_HISTORY === "true",
      },
      model: "extension-local",
      jobs,
      database: {
        migration,
        auditEnabled: true,
      },
      generation: {
        mode: "extension_local",
        backendEnabled: false,
        extensionEnabled: true,
        extensionRequired: true,
        model: LOCAL_QUIZ_MODEL,
        pipelineVersion: LOCAL_QUIZ_PIPELINE_VERSION,
        promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
        validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
        rolloutMode: quizGenerationRolloutMode(c.env),
        states: generationCounts,
      },
      worker: publicWorkerVersion(c.env),
    }),
  );
});

async function count(
  db: D1Database,
  sql: string,
  values: unknown[] = [],
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<CountRow>();
  return Number(row?.count ?? 0);
}

function parseListQuery<T extends z.ZodType>(
  query: Record<string, string>,
  schema: T,
): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_admin_query",
      "The management filters are invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function toIso(value: number): string {
  return new Date(
    value < 1_000_000_000_000 ? value * 1_000 : value,
  ).toISOString();
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    role: AdminRoleSchema.catch("user").parse(row.role),
    banned: Boolean(row.banned),
    banReason: row.ban_reason,
    banExpiresAt: row.ban_expires ? toIso(row.ban_expires) : null,
    emailVerified: Boolean(row.email_verified),
    createdAt: toIso(row.created_at),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    lessonCount: Number(row.lesson_count),
    attemptCount: Number(row.attempt_count),
  };
}

async function getManagedUser(
  db: D1Database,
  userId: string,
): Promise<{ id: string; role: AdminRole }> {
  const row = await db
    .prepare("SELECT id, role FROM user WHERE id = ?")
    .bind(userId)
    .first<{ id: string; role: string }>();
  if (!row) throw new ApiError(404, "admin_user_not_found", "User not found.");
  return { id: row.id, role: AdminRoleSchema.catch("user").parse(row.role) };
}

function assertCanModerate(
  actorId: string,
  actorRole: AdminRole,
  target: { id: string; role: AdminRole },
): void {
  if (target.id === actorId) {
    throw new ApiError(
      409,
      "self_moderation_forbidden",
      "You cannot apply this action to your own account.",
    );
  }
  if (target.role !== "user" && actorRole !== "owner") {
    throw new ApiError(
      403,
      "owner_access_required",
      "Only an owner can manage an operations account.",
    );
  }
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
