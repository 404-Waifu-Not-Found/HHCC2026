import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizShareResponseSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import type { ApiBindings } from "../middleware/authenticated";

// Banks that Library selection and `POST /quizzes/:quizId/start` accept.
const LEGACY_LOCAL_QUIZ_PIPELINE_VERSION = 7;

/** Public routes (mounted before `authenticated`). */
export const publicSharesRouter = new Hono<ApiBindings>();
/** Authenticated routes (mounted after `authenticated`). */
export const sharesRouter = new Hono<ApiBindings>();

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${token}`;
}

sharesRouter.post("/quizzes/:quizId/share", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-share",
    identifier: user.id,
    maximum: 30,
    windowSeconds: 60,
  });
  const bank = await c.env.DB.prepare(
    "SELECT id FROM quiz_banks WHERE id = ? AND user_id = ? AND quality_status = 'passed' AND pipeline_version IN (?, ?)",
  )
    .bind(
      c.req.param("quizId"),
      user.id,
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
    )
    .first<{ id: string }>();
  if (!bank) throw new ApiError(404, "quiz_not_found", "Quiz not found.");

  await c.env.DB.prepare(
    "INSERT INTO quiz_shares (id, quiz_id, owner_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(quiz_id) DO NOTHING",
  )
    .bind(createId(), bank.id, user.id, now())
    .run();
  const share = await c.env.DB.prepare(
    "SELECT id FROM quiz_shares WHERE quiz_id = ?",
  )
    .bind(bank.id)
    .first<{ id: string }>();
  if (!share) {
    throw new ApiError(
      500,
      "quiz_share_unavailable",
      "The share link could not be created.",
    );
  }
  return c.json(
    QuizShareResponseSchema.parse({
      token: share.id,
      url: shareUrl(c.env.APP_ORIGIN, share.id),
    }),
  );
});
