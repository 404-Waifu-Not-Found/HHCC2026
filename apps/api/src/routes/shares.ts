import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizQuestionTypeSchema,
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
  SessionLengthSchema,
  type QuizShareStartSettings,
  type SessionLength,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import type { ApiBindings } from "../middleware/authenticated";
import { progressiveLibraryStartSettings } from "./library";

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

type ClaimableBank = {
  quiz_id: string;
  video_id: string;
  pipeline_version: number;
  session_length: SessionLength;
  quality_summary_json: string;
};

type SourceBankRow = {
  primer: string;
  concepts_json: string;
  watched: number;
  assessment_rationale: string | null;
};

type SourceVideoRow = {
  source: string;
  source_video_id: string;
  original_url: string;
  title: string;
  thumbnail_remote_url: string;
  duration_seconds: number;
  source_language: string | null;
  education_status: string;
  caption_source_category: string | null;
  caption_segment_count: number | null;
  caption_word_count: number | null;
  source_metadata_verified_at: number | null;
};

type SourceQuestionRow = {
  ordinal: number;
  source_question_id: string;
  type: string;
  concept_id: string;
  prompt: string;
  reformulated_prompt: string;
  options_json: string | null;
  items_json: string | null;
  correct_answer_json: string | null;
  rubric_json: string | null;
  explanation: string;
  evidence_segment_ids_json: string;
  difficulty: number;
  generation_metadata_json: string;
};

export function shareStartSettings(bank: {
  pipeline_version: number;
  session_length: SessionLength;
  quality_summary_json: string;
}): QuizShareStartSettings {
  return (
    progressiveLibraryStartSettings({
      pipelineVersion: bank.pipeline_version,
      sessionLength: bank.session_length,
      qualitySummaryJson: bank.quality_summary_json,
    }) ?? { sessionLength: bank.session_length }
  );
}

function claimResponse(bank: ClaimableBank) {
  return QuizShareClaimResponseSchema.parse({
    quizId: bank.quiz_id,
    videoId: bank.video_id,
    startSettings: shareStartSettings(bank),
  });
}

const EXISTING_CLAIM_SQL = `
  SELECT qb.id AS quiz_id, qb.video_id, qb.pipeline_version, qb.session_length, qb.quality_summary_json
  FROM quiz_share_claims cl
  JOIN quiz_banks qb ON qb.id = cl.quiz_id
  WHERE cl.share_id = ? AND cl.user_id = ?`;

sharesRouter.post("/shares/:token/claim", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  await enforceRateLimit(db, {
    namespace: "quiz-share-claim",
    identifier: user.id,
    maximum: 20,
    windowSeconds: 60,
  });
  const share = await loadShare(db, c.req.param("token"));
  if (!share) throw shareNotFound();

  const existing = await db
    .prepare(EXISTING_CLAIM_SQL)
    .bind(share.share_id, user.id)
    .first<ClaimableBank>();
  if (existing) return c.json(claimResponse(existing));
  if (share.owner_id === user.id) return c.json(claimResponse(share));

  const [source, sourceVideo, questions] = await Promise.all([
    db
      .prepare(
        "SELECT primer, concepts_json, watched, assessment_rationale FROM quiz_banks WHERE id = ?",
      )
      .bind(share.quiz_id)
      .first<SourceBankRow>(),
    db
      .prepare(
        "SELECT source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, education_status, caption_source_category, caption_segment_count, caption_word_count, source_metadata_verified_at FROM videos WHERE id = ?",
      )
      .bind(share.video_id)
      .first<SourceVideoRow>(),
    db
      .prepare(
        "SELECT ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json FROM questions WHERE quiz_id = ? ORDER BY ordinal ASC",
      )
      .bind(share.quiz_id)
      .all<SourceQuestionRow>(),
  ]);
  if (!source || !sourceVideo || questions.results.length === 0) {
    throw shareNotFound();
  }

  const timestamp = now();
  const recipientVideo = await db
    .prepare(
      "SELECT id FROM videos WHERE owner_id = ? AND source = ? AND source_video_id = ?",
    )
    .bind(user.id, sourceVideo.source, sourceVideo.source_video_id)
    .first<{ id: string }>();
  const videoId = recipientVideo?.id ?? createId();
  const quizId = createId();

  const statements: D1PreparedStatement[] = [];
  if (!recipientVideo) {
    // thumbnail_key stays NULL: the thumbnail route re-caches from the remote URL.
    statements.push(
      db
        .prepare(
          `INSERT INTO videos
           (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, origin, education_status, caption_source_category, caption_segment_count, caption_word_count, source_metadata_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paste', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          videoId,
          user.id,
          sourceVideo.source,
          sourceVideo.source_video_id,
          sourceVideo.original_url,
          sourceVideo.title,
          sourceVideo.thumbnail_remote_url,
          sourceVideo.duration_seconds,
          sourceVideo.source_language,
          sourceVideo.education_status,
          sourceVideo.caption_source_category,
          sourceVideo.caption_segment_count,
          sourceVideo.caption_word_count,
          sourceVideo.source_metadata_verified_at,
          timestamp,
          timestamp,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO quiz_banks
         (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, import_key, origin, affects_mastery, workplace_thread_id, assessment_rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, NULL, 'quest', 1, NULL, ?, ?)`,
      )
      .bind(
        quizId,
        user.id,
        videoId,
        share.language,
        share.session_length,
        source.primer,
        source.concepts_json,
        source.watched,
        share.pipeline_version,
        share.quality_summary_json,
        source.assessment_rationale,
        timestamp,
      ),
  );
  for (const question of questions.results) {
    statements.push(
      db
        .prepare(
          `INSERT INTO questions
           (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          createId(),
          quizId,
          question.ordinal,
          question.source_question_id,
          question.type,
          question.concept_id,
          question.prompt,
          question.reformulated_prompt,
          question.options_json,
          question.items_json,
          question.correct_answer_json,
          question.rubric_json,
          question.explanation,
          question.evidence_segment_ids_json,
          question.difficulty,
          question.generation_metadata_json,
        ),
    );
  }
  const masteryIndex = statements.length;
  statements.push(
    db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(user.id, videoId, timestamp),
  );
  statements.push(
    db
      .prepare(
        "INSERT INTO quiz_share_claims (share_id, user_id, quiz_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(share.share_id, user.id, quizId, timestamp),
  );

  let results: { meta: { changes: number } }[];
  try {
    results = await db.batch(statements);
  } catch (cause) {
    // Two concurrent claims by the same learner race on the claims primary
    // key; the loser simply returns the copy the winner stored.
    const raced = await db
      .prepare(EXISTING_CLAIM_SQL)
      .bind(share.share_id, user.id)
      .first<ClaimableBank>();
    if (raced) return c.json(claimResponse(raced));
    throw cause;
  }
  const rejected =
    results.length !== statements.length ||
    results.some(
      (result, index) => index !== masteryIndex && result.meta.changes !== 1,
    );
  if (rejected) {
    throw new ApiError(
      409,
      "quiz_share_claim_rejected",
      "The shared quest could not be copied atomically.",
    );
  }
  return c.json(
    claimResponse({
      quiz_id: quizId,
      video_id: videoId,
      pipeline_version: share.pipeline_version,
      session_length: share.session_length,
      quality_summary_json: share.quality_summary_json,
    }),
  );
});
