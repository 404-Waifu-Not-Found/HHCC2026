import { LibraryResponseSchema, MasteryStateSchema, SourceSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiBindings } from "../middleware/authenticated";

const LibraryRowSchema = z.object({
  video_id: z.string().uuid(),
  source: SourceSchema,
  title: z.string(),
  quiz_id: z.string().uuid().nullable(),
  best_score: z.number().nullable(),
  mastery_state: MasteryStateSchema.nullable(),
  next_review_at: z.number().nullable(),
  active_attempt_id: z.string().uuid().nullable(),
  origin: z.enum(["paste", "youtube_history"]),
});

export const libraryRouter = new Hono<ApiBindings>();

libraryRouter.get("/", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `SELECT
      v.id AS video_id,
      v.source,
      v.title,
      v.origin,
      (SELECT qb.id FROM quiz_banks qb WHERE qb.video_id = v.id AND qb.user_id = v.owner_id ORDER BY qb.created_at DESC LIMIT 1) AS quiz_id,
      m.best_score,
      m.state AS mastery_state,
      m.next_review_at,
      (SELECT a.id FROM attempts a JOIN quiz_banks aq ON aq.id = a.quiz_id WHERE aq.video_id = v.id AND a.user_id = v.owner_id AND a.status = 'active' ORDER BY a.updated_at DESC LIMIT 1) AS active_attempt_id
    FROM videos v
    LEFT JOIN mastery m ON m.user_id = v.owner_id AND m.video_id = v.id
    WHERE v.owner_id = ?
    ORDER BY v.updated_at DESC
    LIMIT 250`,
  )
    .bind(user.id)
    .all();
  const parsed = z.array(LibraryRowSchema).safeParse(result.results);
  if (!parsed.success) {
    console.error("Invalid library rows", parsed.error);
    return c.json(LibraryResponseSchema.parse({ dueReviews: [], saved: [], youtubeSuggestions: [] }));
  }
  const timestamp = Date.now();
  const cards = parsed.data.map((row) => {
    const mastery = row.mastery_state ?? "not_started";
    const dueForReview = Boolean(row.next_review_at && row.next_review_at <= timestamp && mastery !== "mastered");
    return {
      videoId: row.video_id,
      quizId: row.quiz_id,
      source: row.source,
      title: row.title,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${row.video_id}/thumbnail`,
      bestScore: row.best_score,
      mastery,
      action: row.active_attempt_id ? ("continue" as const) : dueForReview ? ("review" as const) : ("start" as const),
      dueForReview,
      origin: row.origin,
    };
  });
  return c.json(
    LibraryResponseSchema.parse({
      dueReviews: cards.filter((card) => card.dueForReview),
      saved: cards.filter((card) => card.origin === "paste"),
      youtubeSuggestions: cards.filter((card) => card.origin === "youtube_history"),
    }),
  );
});

