import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizQuestionTypeSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
  SessionLengthSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
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

const MAX_PREVIEW_CONCEPTS = 12;
const ShareTokenSchema = z.string().uuid();

const ShareRowSchema = z.object({
  share_id: z.string().uuid(),
  owner_id: z.string(),
  quiz_id: z.string().uuid(),
  video_id: z.string().uuid(),
  pipeline_version: z.number().int(),
  session_length: SessionLengthSchema,
  quality_summary_json: z.string(),
  language: z.string(),
  concepts_json: z.string(),
  title: z.string(),
  original_url: z.string().url(),
  shared_by: z.string().nullable(),
});
type ShareRow = z.infer<typeof ShareRowSchema>;

// Only shares whose source bank is still a passed, startable pipeline-7/9 bank
// resolve; a deleted or regressed bank makes the link 404 everywhere.
const SHARE_ROW_SQL = `
  SELECT s.id AS share_id, s.owner_id, qb.id AS quiz_id, qb.video_id,
         qb.pipeline_version, qb.session_length, qb.quality_summary_json,
         qb.language, qb.concepts_json, v.title, v.original_url,
         u.name AS shared_by
  FROM quiz_shares s
  JOIN quiz_banks qb ON qb.id = s.quiz_id AND qb.user_id = s.owner_id
    AND qb.quality_status = 'passed' AND qb.pipeline_version IN (?, ?)
  JOIN videos v ON v.id = qb.video_id
  LEFT JOIN user u ON u.id = s.owner_id
  WHERE s.id = ?`;

async function loadShare(
  db: D1Database,
  rawToken: string,
): Promise<ShareRow | null> {
  const token = ShareTokenSchema.safeParse(rawToken);
  if (!token.success) return null;
  const raw = await db
    .prepare(SHARE_ROW_SQL)
    .bind(
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
      token.data,
    )
    .first();
  if (!raw) return null;
  const row = ShareRowSchema.safeParse(raw);
  return row.success ? row.data : null;
}

function shareNotFound(): ApiError {
  return new ApiError(
    404,
    "share_not_found",
    "This share link is no longer available.",
  );
}

const ConceptTitlesSchema = z.array(z.object({ title: z.string() }).loose());

export function previewConcepts(conceptsJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(conceptsJson);
  } catch {
    return [];
  }
  const concepts = ConceptTitlesSchema.safeParse(parsed);
  if (!concepts.success) return [];
  const titles: string[] = [];
  for (const concept of concepts.data) {
    const title = concept.title.trim();
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length === MAX_PREVIEW_CONCEPTS) break;
  }
  return titles;
}

publicSharesRouter.get("/:token", async (c) => {
  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-share-preview",
    identifier: c.req.header("cf-connecting-ip") ?? "unknown",
    maximum: 60,
    windowSeconds: 60,
  });
  const share = await loadShare(c.env.DB, c.req.param("token"));
  if (!share) throw shareNotFound();
  const counts = await c.env.DB.prepare(
    "SELECT type, COUNT(*) AS count FROM questions WHERE quiz_id = ? GROUP BY type ORDER BY MIN(ordinal)",
  )
    .bind(share.quiz_id)
    .all<{ type: string; count: number }>();
  const questionTypes = counts.results.flatMap((row) => {
    const type = QuizQuestionTypeSchema.safeParse(row.type);
    return type.success ? [type.data] : [];
  });
  const questionCount = counts.results.reduce(
    (sum, row) => sum + Number(row.count),
    0,
  );
  return c.json(
    QuizSharePreviewSchema.parse({
      token: share.share_id,
      title: share.title,
      originalUrl: share.original_url,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${share.video_id}/thumbnail`,
      sharedBy: share.shared_by,
      language: share.language,
      sessionLength: share.session_length,
      questionCount,
      questionTypes,
      concepts: previewConcepts(share.concepts_json),
    }),
  );
});

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
