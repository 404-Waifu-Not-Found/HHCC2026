import { PushRegisterRequestSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import type { AppEnv } from "../types";

export const pushRouter = new Hono<ApiBindings>();

export const MAX_DEVICE_TOKENS_PER_USER = 5;
const PUSH_REGISTRATIONS_PER_MINUTE = 10;

export const DEVICE_TOKEN_UPSERT_SQL = `
  INSERT INTO device_tokens
    (id, user_id, token, platform, locale, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, token) DO UPDATE SET
    platform = excluded.platform,
    locale = excluded.locale,
    updated_at = excluded.updated_at
  RETURNING id`;

export const DEVICE_TOKEN_PRUNE_SQL = `
  DELETE FROM device_tokens
  WHERE user_id = ?
    AND id NOT IN (
      SELECT id
      FROM device_tokens
      WHERE user_id = ?
      ORDER BY updated_at DESC, id
      LIMIT ?
    )`;

export const DUE_REVIEW_NOTIFICATION_SQL = `
  WITH due_reviews AS (
    SELECT r.id AS review_id, r.user_id, r.video_id, r.scheduled_for, v.title
    FROM reviews r
    JOIN videos v ON v.id = r.video_id
    WHERE r.completed_at IS NULL
      AND r.notified_at IS NULL
      AND r.scheduled_for <= ?
    ORDER BY r.scheduled_for, r.id
    LIMIT 100
  )
  SELECT r.review_id, r.title, r.video_id, r.scheduled_for, d.token, d.locale
  FROM due_reviews r
  LEFT JOIN device_tokens d ON d.id = (
    SELECT candidate.id
    FROM device_tokens candidate
    WHERE candidate.user_id = r.user_id
      AND (
        candidate.token LIKE 'ExponentPushToken[%]'
        OR candidate.token LIKE 'ExpoPushToken[%]'
      )
    ORDER BY candidate.updated_at DESC, candidate.id
    LIMIT 1
  )
  ORDER BY r.scheduled_for, r.review_id`;

export function isValidExpoPushToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,256}\]$/.test(token)
  );
}

pushRouter.post("/register", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, PushRegisterRequestSchema);
  if (!isValidExpoPushToken(input.token)) {
    throw new ApiError(
      422,
      "invalid_push_token",
      "The device returned an invalid Expo push token.",
    );
  }
  await enforceRateLimit(c.env.DB, {
    namespace: "push-register",
    identifier: user.id,
    maximum: PUSH_REGISTRATIONS_PER_MINUTE,
    windowSeconds: 60,
  });
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(DEVICE_TOKEN_UPSERT_SQL).bind(
      createId(),
      user.id,
      input.token,
      input.platform,
      input.locale,
      timestamp,
      timestamp,
    ),
    c.env.DB.prepare(DEVICE_TOKEN_PRUNE_SQL).bind(
      user.id,
      user.id,
      MAX_DEVICE_TOKENS_PER_USER,
    ),
  ]);
  return c.json({ registered: true });
});

type DueReviewRow = {
  review_id: string;
  title: string;
  token: string | null;
  locale: "en" | "zh-CN" | null;
  video_id: string;
  scheduled_for: number;
};

export async function sendDueReviewNotifications(env: AppEnv): Promise<void> {
  const result = await env.DB.prepare(DUE_REVIEW_NOTIFICATION_SQL)
    .bind(now())
    .all<DueReviewRow>();
  if (!result.results.length) return;

  const messages = result.results
    .filter((row) => isValidExpoPushToken(row.token))
    .map((row) => ({
      to: row.token!,
      sound: "default",
      title:
        row.locale === "zh-CN" ? "复习时间到！" : "A quick review is ready",
      body:
        row.locale === "zh-CN"
          ? `回来巩固《${row.title}》吧。`
          : `Come back and lock in what you learned from “${row.title}.”`,
      data: { videoId: row.video_id, route: "/library" },
    }));
  if (messages.length) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.error(
        "Expo push request failed",
        response.status,
        await response.text(),
      );
      return;
    }
  }
  const notificationTime = now();
  await env.DB.batch(
    [...new Set(result.results.map((row) => row.review_id))].map((reviewId) =>
      env.DB.prepare("UPDATE reviews SET notified_at = ? WHERE id = ?").bind(
        notificationTime,
        reviewId,
      ),
    ),
  );
}
