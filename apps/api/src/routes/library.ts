import {
  LibraryResponseSchema,
  LOCAL_QUIZ_PIPELINE_VERSION,
  MasteryStateSchema,
  SessionLengthSchema,
  SourceSchema,
  type QuizQuestionType,
  type SessionLength,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { tryProgressiveQuizSummary } from "../lib/progressive-quiz";
import type { ApiBindings } from "../middleware/authenticated";

const LibraryRowSchema = z.object({
  video_id: z.string().uuid(),
  original_url: z.string().url(),
  source: SourceSchema,
  title: z.string(),
  quiz_id: z.string().uuid().nullable(),
  quiz_pipeline_version: z.number().int().nullable(),
  quiz_session_length: SessionLengthSchema.nullable(),
  quiz_quality_summary_json: z.string().nullable(),
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
      v.original_url,
      v.origin,
      qb.id AS quiz_id,
      qb.pipeline_version AS quiz_pipeline_version,
      qb.session_length AS quiz_session_length,
      qb.quality_summary_json AS quiz_quality_summary_json,
      m.best_score,
      m.state AS mastery_state,
      m.next_review_at,
      (SELECT a.id FROM attempts a JOIN quiz_banks aq ON aq.id = a.quiz_id AND aq.pipeline_version IN (7, ?) AND aq.quality_status = 'passed' WHERE aq.video_id = v.id AND a.user_id = v.owner_id AND a.status = 'active' ORDER BY a.updated_at DESC LIMIT 1) AS active_attempt_id
    FROM videos v
    LEFT JOIN mastery m ON m.user_id = v.owner_id AND m.video_id = v.id
    LEFT JOIN quiz_banks qb ON qb.id = (
      SELECT candidate.id
      FROM quiz_banks candidate
      WHERE candidate.video_id = v.id
        AND candidate.user_id = v.owner_id
        AND candidate.pipeline_version IN (7, ?)
        AND candidate.quality_status = 'passed'
      ORDER BY candidate.created_at DESC
      LIMIT 1
    )
    WHERE v.owner_id = ? AND v.source = 'youtube'
    ORDER BY v.updated_at DESC
    LIMIT 250`,
  )
    .bind(LOCAL_QUIZ_PIPELINE_VERSION, LOCAL_QUIZ_PIPELINE_VERSION, user.id)
    .all();
  const parsed = z.array(LibraryRowSchema).safeParse(result.results);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        scope: "library",
        event: "invalid_rows",
        issueCount: parsed.error.issues.length,
      }),
    );
    return c.json(
      LibraryResponseSchema.parse({
        dueReviews: [],
        saved: [],
        youtubeSuggestions: [],
      }),
    );
  }
  const timestamp = Date.now();
  const cards = parsed.data.map((row) => {
    const startSettings = progressiveLibraryStartSettings({
      pipelineVersion: row.quiz_pipeline_version,
      sessionLength: row.quiz_session_length,
      qualitySummaryJson: row.quiz_quality_summary_json,
    });
    const quizId =
      row.quiz_pipeline_version === LOCAL_QUIZ_PIPELINE_VERSION &&
      !startSettings
        ? null
        : row.quiz_id;
    const mastery = row.mastery_state ?? "not_started";
    const dueForReview = Boolean(
      row.next_review_at &&
      row.next_review_at <= timestamp &&
      mastery !== "mastered",
    );
    return {
      videoId: row.video_id,
      quizId,
      attemptId: row.active_attempt_id,
      originalUrl: row.original_url,
      source: row.source,
      title: row.title,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${row.video_id}/thumbnail`,
      bestScore: row.best_score,
      mastery,
      action: row.active_attempt_id
        ? ("continue" as const)
        : dueForReview
          ? ("review" as const)
          : ("start" as const),
      dueForReview,
      startSettings,
      origin: row.origin,
    };
  });
  return c.json(
    LibraryResponseSchema.parse({
      dueReviews: cards.filter((card) => card.dueForReview),
      saved: cards.filter((card) => card.origin === "paste"),
      youtubeSuggestions: cards.filter(
        (card) => card.origin === "youtube_history",
      ),
    }),
  );
});

export function progressiveLibraryStartSettings(input: {
  pipelineVersion: number | null;
  sessionLength: SessionLength | null;
  qualitySummaryJson: string | null;
}): {
  sessionLength: SessionLength;
  questionTypes: QuizQuestionType[];
} | null {
  if (
    input.pipelineVersion !== LOCAL_QUIZ_PIPELINE_VERSION ||
    !input.sessionLength ||
    !input.qualitySummaryJson
  ) {
    return null;
  }
  const summary = tryProgressiveQuizSummary(input.qualitySummaryJson);
  if (!summary) return null;
  const expectedSessionLength =
    summary.plannedCount === 5
      ? "short"
      : summary.plannedCount === 10
        ? "medium"
        : "long";
  if (input.sessionLength !== expectedSessionLength) return null;
  return {
    sessionLength: input.sessionLength,
    questionTypes: [...summary.requestedQuestionTypes],
  };
}
