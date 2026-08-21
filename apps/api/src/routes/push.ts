import { PushRegisterRequestSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { createId, now } from "../lib/ids";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import type { AppEnv } from "../types";

export const pushRouter = new Hono<ApiBindings>();

pushRouter.post("/register", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, PushRegisterRequestSchema);
  const timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO device_tokens (id, user_id, token, platform, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, locale = excluded.locale, updated_at = excluded.updated_at",
  )
    .bind(createId(), user.id, input.token, input.platform, input.locale, timestamp, timestamp)
    .run();
  return c.json({ registered: true });
});

type DueReviewRow = {
  review_id: string;
  title: string;
  token: string;
  locale: "en" | "zh-CN";
  video_id: string;
};

export async function sendDueReviewNotifications(env: AppEnv): Promise<void> {
  const result = await env.DB.prepare(
    `SELECT r.id AS review_id, v.title, d.token, d.locale, r.video_id
     FROM reviews r
     JOIN videos v ON v.id = r.video_id
     JOIN device_tokens d ON d.user_id = r.user_id
     WHERE r.completed_at IS NULL AND r.notified_at IS NULL AND r.scheduled_for <= ?
     ORDER BY r.scheduled_for
     LIMIT 100`,
  )
    .bind(now())
    .all<DueReviewRow>();
  if (!result.results.length) return;

  const messages = result.results
    .filter((row) => row.token.startsWith("ExponentPushToken[") || row.token.startsWith("ExpoPushToken["))
    .map((row) => ({
      to: row.token,
      sound: "default",
      title: row.locale === "zh-CN" ? "复习时间到！" : "A quick review is ready",
      body:
        row.locale === "zh-CN"
          ? `回来巩固《${row.title}》吧。`
          : `Come back and lock in what you learned from “${row.title}.”`,
      data: { videoId: row.video_id, route: "/library" },
    }));
  if (!messages.length) return;
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
    console.error("Expo push request failed", response.status, await response.text());
    return;
  }
  const notificationTime = now();
  await env.DB.batch(
    [...new Set(result.results.map((row) => row.review_id))].map((reviewId) =>
      env.DB.prepare("UPDATE reviews SET notified_at = ? WHERE id = ?").bind(notificationTime, reviewId),
    ),
  );
}

