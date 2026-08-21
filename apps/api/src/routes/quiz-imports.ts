import {
  ExtensionQuizImportRequestSchema,
  ExtensionQuizImportResponseSchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  MAX_COMPLETE_TRANSCRIPT_CHARACTERS,
  transcriptCompletenessMatches,
  transcriptTextFingerprint,
  type GeneratedQuestion,
  type LocalQuizSubmission,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { validateTranscriptQuality } from "../lib/transcript-quality";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const MAX_DEVICE_TRANSCRIPT_MS = 90 * 60 * 1_000;
const IdempotencyKeySchema = z.string().uuid();
const QUIZ_IMPORT_VERSION = "extension-import-v1" as const;

export const quizImportsRouter = new Hono<ApiBindings>();

quizImportsRouter.post("/", async (c) => {
  const user = c.get("user");
  const idempotencyKey = IdempotencyKeySchema.safeParse(
    c.req.header("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "A valid idempotency key is required.",
    );
  }
  const existing = await findImportedQuiz(
    c.env.DB,
    user.id,
    idempotencyKey.data,
  );
  if (existing) {
    return c.json(
      ExtensionQuizImportResponseSchema.parse({ quizId: existing.id }),
    );
  }
  await enforceRateLimit(c.env.DB, {
    namespace: "extension-quiz-import",
    identifier: user.id,
    maximum: 8,
    windowSeconds: 60,
  });
  const input = await parseJson(c, ExtensionQuizImportRequestSchema);
  const transcript = input.transcript;
  const video = await c.env.DB.prepare(
    "SELECT id, duration_seconds FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(transcript.videoId, user.id)
    .first<{ id: string; duration_seconds: number }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  const extensionDurationSeconds =
    transcript.acquisition === "youtube_browser_extension" &&
    video.duration_seconds === 0 &&
    transcript.completeness.expectedDurationMs > 0 &&
    transcript.completeness.expectedDurationMs >=
      transcript.completeness.lastEndMs &&
    transcript.completeness.expectedDurationMs -
      transcript.completeness.lastEndMs <=
      30_000
      ? transcript.completeness.expectedDurationMs / 1_000
      : null;
  const expectedDurationSeconds =
    extensionDurationSeconds ?? video.duration_seconds;
  if (
    !transcriptCompletenessMatches(
      transcript.completeness,
      transcript.segments,
      expectedDurationSeconds,
    )
  ) {
    throw new ApiError(
      422,
      "incomplete_transcript",
      "The complete-transcript manifest did not match the uploaded subtitles.",
    );
  }
  verifyTranscriptShape(transcript);
  const quality = validateTranscriptQuality({
    origin: transcript.origin,
    language: transcript.language,
    expectedDurationMs: transcript.completeness.expectedDurationMs,
    segments: transcript.segments,
  });
  if (!quality.passed) {
    throw new ApiError(
      422,
      "transcript_quality_failed",
      "This transcript is not complete enough to store with a quiz.",
      { issueCodes: quality.issueCodes },
    );
  }
  if (
    input.quiz.transcriptFingerprint !==
    transcriptTextFingerprint(transcript.segments)
  ) {
    throw new ApiError(
      422,
      "transcript_fingerprint_mismatch",
      "The quiz was created from a different transcript.",
    );
  }

  const quizId = createId();
  const transcriptKey = `transcripts/${user.id}/${transcript.videoId}/${quizId}.json`;
  await c.env.PRIVATE_BUCKET.put(
    transcriptKey,
    JSON.stringify({
      version: 1,
      videoId: transcript.videoId,
      language: transcript.language,
      origin: transcript.origin,
      acquisition: transcript.acquisition,
      completeness: transcript.completeness,
      quality: quality.summary,
      segments: transcript.segments,
    }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        ownerId: user.id,
        videoId: transcript.videoId,
        origin: transcript.origin,
      },
    },
  );
  try {
    await persistImportedQuiz({
      db: c.env.DB,
      quizId,
      userId: user.id,
      importKey: idempotencyKey.data,
      submission: input.quiz,
      transcript,
      extensionDurationSeconds,
    });
  } catch (error) {
    await c.env.PRIVATE_BUCKET.delete(transcriptKey);
    const raced = await findImportedQuiz(
      c.env.DB,
      user.id,
      idempotencyKey.data,
    );
    if (raced) {
      return c.json(
        ExtensionQuizImportResponseSchema.parse({ quizId: raced.id }),
      );
    }
    throw error;
  }
  return c.json(ExtensionQuizImportResponseSchema.parse({ quizId }), 201);
});

function verifyTranscriptShape(
  transcript: z.infer<typeof ExtensionQuizImportRequestSchema>["transcript"],
): void {
  const ids = new Set<string>();
  let characterCount = 0;
  let previousStart = -1;
  for (const segment of transcript.segments) {
    if (ids.has(segment.id)) {
      throw new ApiError(
        422,
        "duplicate_segment_id",
        "Transcript segment IDs must be unique.",
      );
    }
    if (segment.startMs < previousStart) {
      throw new ApiError(
        422,
        "unsorted_transcript",
        "Transcript segments must be sorted by start time.",
      );
    }
    if (
      (transcript.origin === "device_whisper" ||
        transcript.origin === "browser_tab_capture") &&
      segment.endMs > MAX_DEVICE_TRANSCRIPT_MS
    ) {
      throw new ApiError(
        422,
        "transcript_too_long",
        "On-device transcripts are limited to 90 minutes.",
      );
    }
    ids.add(segment.id);
    previousStart = segment.startMs;
    characterCount += segment.text.length;
  }
  if (characterCount > MAX_COMPLETE_TRANSCRIPT_CHARACTERS) {
    throw new ApiError(
      413,
      "transcript_too_large",
      "This transcript is too large to import.",
    );
  }
}

async function persistImportedQuiz(input: {
  db: D1Database;
  quizId: string;
  userId: string;
  importKey: string;
  submission: LocalQuizSubmission;
  transcript: z.infer<typeof ExtensionQuizImportRequestSchema>["transcript"];
  extensionDurationSeconds: number | null;
}): Promise<void> {
  const timestamp = now();
  const summary = {
    pipelineVersion: LOCAL_QUIZ_PIPELINE_VERSION,
    model: LOCAL_QUIZ_MODEL,
    reasoningEffort: "high",
    promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
    validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
    importVersion: QUIZ_IMPORT_VERSION,
    qualityStatus: "passed",
    plannedCount: input.submission.generation.questions.length,
    passedCount: input.submission.generation.questions.length,
    ...input.submission.metrics,
  };
  const statements = [
    input.db
      .prepare(
        `INSERT INTO quiz_banks
         (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, import_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?, ?)`,
      )
      .bind(
        input.quizId,
        input.userId,
        input.transcript.videoId,
        input.transcript.quizLanguage,
        input.transcript.sessionLength,
        input.submission.generation.primer,
        JSON.stringify(input.submission.generation.concepts),
        input.transcript.watched ? 1 : 0,
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
        input.importKey,
        timestamp,
      ),
    ...input.submission.generation.questions.map((question, ordinal) => {
      const stored = questionStorageFields(question);
      return input.db
        .prepare(
          "INSERT INTO questions (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          createId(),
          input.quizId,
          ordinal,
          question.id,
          question.type,
          question.conceptId,
          question.prompt,
          question.reformulatedPrompt,
          stored.optionsJson,
          stored.correctAnswerJson,
          stored.rubricJson,
          question.explanation,
          JSON.stringify(question.evidenceSegmentIds),
          question.difficulty,
          JSON.stringify({
            source: "extension-local",
            model: LOCAL_QUIZ_MODEL,
            schemaValidated: true,
          }),
        );
    }),
    input.db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(input.userId, input.transcript.videoId, timestamp),
    input.db
      .prepare(
        "UPDATE videos SET education_status = 'educational', duration_seconds = CASE WHEN duration_seconds = 0 AND ? IS NOT NULL THEN ? ELSE duration_seconds END, updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .bind(
        input.extensionDurationSeconds,
        input.extensionDurationSeconds === null
          ? null
          : Math.ceil(input.extensionDurationSeconds),
        timestamp,
        input.transcript.videoId,
        input.userId,
      ),
  ];
  const results = await input.db.batch(statements);
  if (
    results.length !== statements.length ||
    !results[0]?.meta.changes ||
    !results.at(-1)?.meta.changes
  ) {
    throw new ApiError(
      409,
      "quiz_import_rejected",
      "The extension quiz could not be stored atomically.",
    );
  }
}

function questionStorageFields(question: GeneratedQuestion) {
  return {
    optionsJson:
      question.type === "multiple_choice"
        ? JSON.stringify(question.options)
        : null,
    correctAnswerJson:
      question.type === "short_answer"
        ? null
        : JSON.stringify(question.correctAnswer),
    rubricJson:
      question.type === "short_answer" ? JSON.stringify(question.rubric) : null,
  };
}

async function findImportedQuiz(
  db: D1Database,
  userId: string,
  importKey: string,
): Promise<{ id: string } | null> {
  return db
    .prepare(
      "SELECT id FROM quiz_banks WHERE user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'passed'",
    )
    .bind(userId, importKey, LOCAL_QUIZ_PIPELINE_VERSION)
    .first<{ id: string }>();
}
