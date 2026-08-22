import { Hono } from "hono";
import {
  ProfileAvatarResponseSchema,
  LeaderboardResponseSchema,
  ProfileLearningStatsResponseSchema,
} from "@clipquest/contracts";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import type { ApiBindings } from "../middleware/authenticated";

const MAX_AVATAR_BYTES = 1_500_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export const PROFILE_DAILY_COMPLETIONS_SQL = `SELECT date(completed_at / 1000, 'unixepoch') AS completion_date,
              COUNT(*) AS completion_count
         FROM attempts
        WHERE user_id = ?
          AND status = 'complete'
          AND completed_at IS NOT NULL
          AND completed_at >= ?
        GROUP BY completion_date
        ORDER BY completion_date ASC`;

export const profileRouter = new Hono<ApiBindings>();

profileRouter.get("/stats", async (c) => {
  const user = c.get("user");
  const [stats, dailyCompletions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
        COUNT(*) AS completed_lessons,
        COALESCE(SUM(completed.duration_seconds), 0) AS total_duration_seconds
      FROM (
        SELECT v.id, MAX(v.duration_seconds) AS duration_seconds
        FROM videos v
        WHERE v.owner_id = ?
          AND EXISTS (
            SELECT 1
            FROM quiz_banks qb
            JOIN attempts a ON a.quiz_id = qb.id
            WHERE qb.video_id = v.id
              AND a.user_id = v.owner_id
              AND a.status = 'complete'
          )
        GROUP BY v.id
      ) completed`,
    )
      .bind(user.id)
      .first<{
        completed_lessons: number | null;
        total_duration_seconds: number | null;
      }>(),
    c.env.DB.prepare(PROFILE_DAILY_COMPLETIONS_SQL)
      .bind(user.id, Math.floor(now() / DAY_MS) * DAY_MS - 370 * DAY_MS)
      .all<{ completion_date: string; completion_count: number }>(),
  ]);
  return c.json(
    ProfileLearningStatsResponseSchema.parse({
      completedLessons: Number(stats?.completed_lessons ?? 0),
      totalDurationSeconds: Number(stats?.total_duration_seconds ?? 0),
      dailyQuizCompletions: dailyCompletions.results.map((entry) => ({
        date: entry.completion_date,
        count: Number(entry.completion_count),
      })),
    }),
  );
});

profileRouter.get("/leaderboard", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.image,
            COUNT(DISTINCT CASE WHEN a.status = 'complete' THEN a.quiz_id END) AS completed_quizzes
       FROM user u
       LEFT JOIN attempts a ON a.user_id = u.id
      GROUP BY u.id, u.name
      ORDER BY completed_quizzes DESC, u.name COLLATE NOCASE ASC
      LIMIT 500`,
  ).all<{
    id: string;
    name: string | null;
    image: string | null;
    completed_quizzes: number | null;
  }>();
  return c.json(
    LeaderboardResponseSchema.parse({
      entries: rows.results.map((row, index) => ({
        userId: row.id,
        rank: index + 1,
        name: row.name?.trim() || "ClipQuest learner",
        image: row.image,
        completedQuizzes: Number(row.completed_quizzes ?? 0),
      })),
    }),
  );
});

profileRouter.put("/avatar", async (c) => {
  const user = c.get("user");
  const form = await c.req.raw.formData();
  const value = form.get("file") ?? form.get("avatar");
  if (!(value instanceof File)) {
    throw new ApiError(400, "avatar_missing", "Choose an image to upload.");
  }
  if (!ALLOWED_TYPES.has(value.type)) {
    throw new ApiError(400, "avatar_type", "Use a JPEG, PNG, or WebP image.");
  }
  if (value.size <= 0 || value.size > MAX_AVATAR_BYTES) {
    throw new ApiError(
      413,
      "avatar_size",
      "Profile images must be under 1.5 MB.",
    );
  }
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!looksLikeImage(value.type, bytes)) {
    throw new ApiError(
      400,
      "avatar_invalid",
      "The uploaded image is malformed.",
    );
  }

  const revision = `${now()}-${createId()}`;
  const key = `avatars/${user.id}/${revision}${extensionFor(value.type)}`;
  await c.env.PRIVATE_BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: value.type,
      cacheControl: "private, max-age=31536000, immutable",
    },
  });
  const previous = await c.env.DB.prepare("SELECT image FROM user WHERE id = ?")
    .bind(user.id)
    .first<{ image: string | null }>();
  await c.env.DB.prepare(
    "UPDATE user SET image = ?, updated_at = ? WHERE id = ?",
  )
    .bind(key, now(), user.id)
    .run();
  if (previous?.image?.startsWith(`avatars/${user.id}/`)) {
    await c.env.PRIVATE_BUCKET.delete(previous.image).catch(() => undefined);
  }
  return c.json(
    ProfileAvatarResponseSchema.parse({
      image: `/api/profile/avatar?revision=${encodeURIComponent(revision)}`,
      revision,
    }),
  );
});

profileRouter.get("/avatar", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT image FROM user WHERE id = ?")
    .bind(user.id)
    .first<{ image: string | null }>();
  if (!row?.image?.startsWith(`avatars/${user.id}/`)) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const object = await c.env.PRIVATE_BUCKET.get(row.image);
  if (!object)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
});

profileRouter.delete("/avatar", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT image FROM user WHERE id = ?")
    .bind(user.id)
    .first<{ image: string | null }>();
  await c.env.DB.prepare(
    "UPDATE user SET image = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now(), user.id)
    .run();
  if (row?.image?.startsWith(`avatars/${user.id}/`))
    await c.env.PRIVATE_BUCKET.delete(row.image).catch(() => undefined);
  return c.json(
    ProfileAvatarResponseSchema.parse({ image: null, revision: null }),
  );
});

function extensionFor(type: string): string {
  return type === "image/png"
    ? ".png"
    : type === "image/webp"
      ? ".webp"
      : ".jpg";
}

function looksLikeImage(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === "image/png")
    return bytes
      .slice(0, 8)
      .every(
        (value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index],
      );
  if (type === "image/webp")
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}
