import {
  GenerationStageSchema,
  GenerationStatusSchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  LocalQuizContextSchema,
  LocalQuizSubmissionSchema,
  MAX_COMPLETE_TRANSCRIPT_CHARACTERS,
  QuizQuestionTypesSchema,
  SessionLengthSchema,
  TranscriptUploadRequestSchema,
  TranscriptUploadResponseSchema,
  questionLimitForSession,
  transcriptCompletenessMatches,
  transcriptTextFingerprint,
  type GeneratedQuestion,
  type LocalQuizContext,
  type LocalQuizSubmission,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { StoredTranscriptSchema } from "../lib/stored-transcript";
import { validateTranscriptQuality } from "../lib/transcript-quality";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const MAX_DEVICE_TRANSCRIPT_MS = 90 * 60 * 1_000;
const IdempotencyKeySchema = z.string().uuid();
export const LOCAL_QUIZ_ORCHESTRATOR_VERSION = "extension-local-v1" as const;

type LocalGenerationJob = {
  id: string;
  user_id: string;
  video_id: string;
  quiz_language: "en" | "zh-CN";
  session_length: "short" | "medium" | "long";
  watched: number;
  transcript_key: string;
  question_types_json: string;
  title: string;
  state: "queued" | "running" | "complete" | "failed";
  cancel_requested: number;
  pipeline_version: number;
};

type JobRow = {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  stage: string;
  progress: number;
  quiz_id: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
  pipeline_version: number;
};

export const transcriptsRouter = new Hono<ApiBindings>();
export const generationRouter = new Hono<ApiBindings>();

transcriptsRouter.post("/", async (c) => {
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
  const existing = await findJobByIdempotencyKey(
    c.env.DB,
    user.id,
    idempotencyKey.data,
  );
  if (existing) {
    return c.json(
      TranscriptUploadResponseSchema.parse({
        jobId: existing.id,
        stage: existing.stage,
      }),
      202,
    );
  }
  await enforceRateLimit(c.env.DB, {
    namespace: "transcript-upload",
    identifier: user.id,
    maximum: 8,
    windowSeconds: 60,
  });
  const input = await parseJson(c, TranscriptUploadRequestSchema);
  const video = await c.env.DB.prepare(
    "SELECT id, duration_seconds FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(input.videoId, user.id)
    .first<{ id: string; duration_seconds: number }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");
  const extensionDerivedDurationSeconds =
    input.acquisition === "youtube_browser_extension" &&
    video.duration_seconds === 0 &&
    input.completeness.expectedDurationMs > 0 &&
    input.completeness.expectedDurationMs >= input.completeness.lastEndMs &&
    input.completeness.expectedDurationMs - input.completeness.lastEndMs <=
      30_000
      ? input.completeness.expectedDurationMs / 1_000
      : null;
  const expectedDurationSeconds =
    extensionDerivedDurationSeconds ?? video.duration_seconds;
  if (
    !transcriptCompletenessMatches(
      input.completeness,
      input.segments,
      expectedDurationSeconds,
    )
  ) {
    throw new ApiError(
      422,
      "incomplete_transcript",
      "The complete-transcript manifest did not match the uploaded subtitles.",
    );
  }
  const ids = new Set<string>();
  let characterCount = 0;
  let previousStart = -1;
  for (const segment of input.segments) {
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
      (input.origin === "device_whisper" ||
        input.origin === "browser_tab_capture") &&
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
      "This transcript is too large for the local model contract.",
    );
  }
  const transcriptQuality = validateTranscriptQuality({
    origin: input.origin,
    language: input.language,
    expectedDurationMs: input.completeness.expectedDurationMs,
    segments: input.segments,
  });
  if (!transcriptQuality.passed) {
    throw new ApiError(
      422,
      "transcript_quality_failed",
      "This transcript is not complete enough for a trustworthy quiz.",
      { issueCodes: transcriptQuality.issueCodes },
    );
  }

  const jobId = createId();
  const timestamp = now();
  const transcriptKey = `transcripts/${user.id}/${input.videoId}/${jobId}.json`;
  await c.env.PRIVATE_BUCKET.put(
    transcriptKey,
    JSON.stringify({
      version: 1,
      videoId: input.videoId,
      language: input.language,
      origin: input.origin,
      acquisition: input.acquisition,
      completeness: input.completeness,
      quality: transcriptQuality.summary,
      segments: input.segments,
    }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        ownerId: user.id,
        videoId: input.videoId,
        origin: input.origin,
      },
    },
  );
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO generation_jobs (id, user_id, video_id, state, stage, progress, quiz_language, session_length, watched, transcript_key, question_types_json, idempotency_key, pipeline_version, workflow_instance_id, model, reasoning_effort, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'planning_questions', 0.12, ?, ?, ?, ?, ?, ?, ?, NULL, 'user-supplied-extension-key', 'high', ?, ?)",
      ).bind(
        jobId,
        user.id,
        input.videoId,
        input.quizLanguage,
        input.sessionLength,
        input.watched ? 1 : 0,
        transcriptKey,
        JSON.stringify(input.questionTypes),
        idempotencyKey.data,
        LOCAL_QUIZ_PIPELINE_VERSION,
        timestamp,
        timestamp,
      ),
      c.env.DB.prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      ).bind(user.id, input.videoId, timestamp),
      ...(extensionDerivedDurationSeconds === null
        ? []
        : [
            c.env.DB.prepare(
              "UPDATE videos SET duration_seconds = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND duration_seconds = 0",
            ).bind(
              Math.ceil(extensionDerivedDurationSeconds),
              timestamp,
              input.videoId,
              user.id,
            ),
          ]),
    ]);
  } catch (error) {
    await c.env.PRIVATE_BUCKET.delete(transcriptKey);
    const raced = await findJobByIdempotencyKey(
      c.env.DB,
      user.id,
      idempotencyKey.data,
    );
    if (raced) {
      return c.json(
        TranscriptUploadResponseSchema.parse({
          jobId: raced.id,
          stage: raced.stage,
        }),
        202,
      );
    }
    throw error;
  }
  return c.json(
    TranscriptUploadResponseSchema.parse({
      jobId,
      stage: "planning_questions",
    }),
    202,
  );
});

generationRouter.get("/idempotency/:key", async (c) => {
  const user = c.get("user");
  const key = IdempotencyKeySchema.safeParse(c.req.param("key"));
  if (!key.success)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  const job = await findJobByIdempotencyKey(c.env.DB, user.id, key.data);
  if (!job) return c.json(null);
  return c.json(
    TranscriptUploadResponseSchema.parse({ jobId: job.id, stage: job.stage }),
  );
});

generationRouter.get("/:jobId/context", async (c) => {
  const user = c.get("user");
  const job = await findLocalJob(c.env.DB, c.req.param("jobId"), user.id);
  if (!job || job.pipeline_version !== LOCAL_QUIZ_PIPELINE_VERSION) {
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  }
  if (job.cancel_requested || job.state === "failed") {
    throw new ApiError(
      409,
      "generation_unavailable",
      "This generation job is no longer available.",
    );
  }
  const transcript = await loadTranscript(c.env.PRIVATE_BUCKET, job);
  if (job.state !== "complete") {
    await c.env.DB.prepare(
      "UPDATE generation_jobs SET state = 'running', stage = 'planning_questions', progress = 0.2, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'queued' AND cancel_requested = 0",
    )
      .bind(now(), job.id, user.id)
      .run();
  }
  return c.json(
    LocalQuizContextSchema.parse(extensionQuizContext(job, transcript)),
  );
});

generationRouter.post("/:jobId/complete", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "local-quiz-commit",
    identifier: user.id,
    maximum: 8,
    windowSeconds: 60,
  });
  const job = await findLocalJob(c.env.DB, c.req.param("jobId"), user.id);
  if (!job || job.pipeline_version !== LOCAL_QUIZ_PIPELINE_VERSION) {
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  }
  if (job.state === "complete") {
    const existing = await findOwnedJob(c.env.DB, job.id, user.id);
    return c.json(statusFromJob(existing!));
  }
  if (job.cancel_requested || job.state === "failed") {
    throw new ApiError(
      409,
      "generation_unavailable",
      "This generation job is no longer available.",
    );
  }
  const transcript = await loadTranscript(c.env.PRIVATE_BUCKET, job);
  const context = extensionQuizContext(job, transcript);
  const submission = await parseJson(c, LocalQuizSubmissionSchema);
  if (submission.transcriptFingerprint !== context.transcriptFingerprint) {
    throw new ApiError(
      422,
      "transcript_fingerprint_mismatch",
      "The quiz was created from a different transcript.",
    );
  }
  await c.env.DB.prepare(
    "UPDATE generation_jobs SET state = 'running', stage = 'finalizing_questions', progress = 0.96, updated_at = ? WHERE id = ? AND user_id = ? AND state IN ('queued', 'running') AND cancel_requested = 0",
  )
    .bind(now(), job.id, user.id)
    .run();
  const quizId = await commitExtensionQuiz(c.env.DB, job, submission);
  return c.json(
    GenerationStatusSchema.parse({
      jobId: job.id,
      stage: "complete",
      progress: 1,
      quizId,
      error: null,
    }),
  );
});

generationRouter.get("/:jobId", async (c) => {
  const user = c.get("user");
  const job = await findOwnedJob(c.env.DB, c.req.param("jobId"), user.id);
  if (!job)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  return c.json(statusFromJob(job));
});

generationRouter.post("/:jobId/retry", async (c) => {
  const user = c.get("user");
  const job = await findOwnedJob(c.env.DB, c.req.param("jobId"), user.id);
  if (!job || job.pipeline_version !== LOCAL_QUIZ_PIPELINE_VERSION) {
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  }
  if (job.state === "complete") return c.json(statusFromJob(job));
  if (job.cancel_requested || job.error_code === "generation_cancelled") {
    throw new ApiError(
      409,
      "generation_cancelled",
      "This generation was cancelled. Start a new quiz instead.",
    );
  }
  await c.env.DB.prepare(
    "UPDATE generation_jobs SET state = 'running', stage = 'planning_questions', progress = 0.2, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND state IN ('queued', 'running', 'failed') AND cancel_requested = 0 AND quiz_id IS NULL",
  )
    .bind(now(), job.id, user.id)
    .run();
  return c.json(
    GenerationStatusSchema.parse({
      jobId: job.id,
      stage: "planning_questions",
      progress: 0.2,
      quizId: null,
      error: null,
    }),
  );
});

generationRouter.delete("/:jobId", async (c) => {
  const user = c.get("user");
  const job = await findOwnedJob(c.env.DB, c.req.param("jobId"), user.id);
  if (!job)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  if (job.state === "complete") {
    throw new ApiError(
      409,
      "generation_complete",
      "This quiz has already been created.",
    );
  }
  await c.env.DB.prepare(
    "UPDATE generation_jobs SET state = 'failed', stage = 'failed', progress = 1, cancel_requested = 1, error_code = 'generation_cancelled', error_message = 'Quiz creation was cancelled.', updated_at = ? WHERE id = ? AND user_id = ? AND state != 'complete'",
  )
    .bind(now(), job.id, user.id)
    .run();
  return c.json(
    GenerationStatusSchema.parse({
      jobId: job.id,
      stage: "failed",
      progress: 1,
      quizId: null,
      error: {
        code: "generation_cancelled",
        message: "Quiz creation was cancelled.",
      },
    }),
  );
});

function parseJobQuestionTypes(value: string): QuizQuestionType[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    decoded = null;
  }
  const parsed = QuizQuestionTypesSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "question_types_invalid",
      "The selected question types failed integrity checks.",
    );
  }
  return parsed.data;
}

function extensionQuizContext(
  job: LocalGenerationJob,
  transcript: z.infer<typeof StoredTranscriptSchema>,
): LocalQuizContext {
  const sessionLength = SessionLengthSchema.parse(job.session_length);
  return {
    protocolVersion: 1,
    jobId: job.id,
    videoId: job.video_id,
    title: job.title,
    quizLanguage: job.quiz_language,
    questionTypes: parseJobQuestionTypes(job.question_types_json),
    questionCount: questionLimitForSession(sessionLength) as 5 | 10 | 15,
    transcriptFingerprint: transcriptTextFingerprint(transcript.segments),
    transcriptLanguage: transcript.language,
    segments: transcript.segments,
  };
}

async function commitExtensionQuiz(
  db: D1Database,
  job: LocalGenerationJob,
  submission: LocalQuizSubmission,
): Promise<string> {
  const quizId = createId();
  const timestamp = now();
  const summary = {
    pipelineVersion: LOCAL_QUIZ_PIPELINE_VERSION,
    model: LOCAL_QUIZ_MODEL,
    reasoningEffort: "high",
    promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
    validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
    orchestratorVersion: LOCAL_QUIZ_ORCHESTRATOR_VERSION,
    qualityStatus: "passed",
    plannedCount: submission.generation.questions.length,
    passedCount: submission.generation.questions.length,
    ...submission.metrics,
  };
  const statements = [
    db
      .prepare(
        `INSERT INTO quiz_banks
       (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM generation_jobs
         WHERE id = ? AND user_id = ? AND video_id = ?
           AND pipeline_version = ? AND state IN ('queued', 'running')
           AND cancel_requested = 0 AND quiz_id IS NULL
       )`,
      )
      .bind(
        quizId,
        job.user_id,
        job.video_id,
        job.quiz_language,
        job.session_length,
        submission.generation.primer,
        JSON.stringify(submission.generation.concepts),
        job.watched,
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
        timestamp,
        job.id,
        job.user_id,
        job.video_id,
        LOCAL_QUIZ_PIPELINE_VERSION,
      ),
    ...submission.generation.questions.map((question, ordinal) => {
      const stored = questionStorageFields(question);
      return db
        .prepare(
          "INSERT INTO questions (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quiz_banks WHERE id = ? AND pipeline_version = ? AND quality_status = 'passed')",
        )
        .bind(
          createId(),
          quizId,
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
          quizId,
          LOCAL_QUIZ_PIPELINE_VERSION,
        );
    }),
    db
      .prepare(
        `UPDATE generation_jobs
       SET state = 'complete', stage = 'complete', progress = 1,
           quiz_id = ?, quality_summary_json = ?, error_code = NULL,
           error_message = NULL, updated_at = ?
       WHERE id = ? AND user_id = ? AND video_id = ?
         AND pipeline_version = ? AND state IN ('queued', 'running')
         AND cancel_requested = 0 AND quiz_id IS NULL`,
      )
      .bind(
        quizId,
        JSON.stringify(summary),
        timestamp,
        job.id,
        job.user_id,
        job.video_id,
        LOCAL_QUIZ_PIPELINE_VERSION,
      ),
    db
      .prepare(
        "UPDATE videos SET education_status = 'educational', updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .bind(timestamp, job.video_id, job.user_id),
  ];
  const results = await db.batch(statements);
  if (
    results.length !== statements.length ||
    !results[0]?.meta.changes ||
    !results.at(-2)?.meta.changes
  ) {
    throw new ApiError(
      409,
      "local_quiz_commit_rejected",
      "The extension quiz could not be committed atomically.",
    );
  }
  return quizId;
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

async function loadTranscript(
  bucket: R2Bucket,
  job: LocalGenerationJob,
): Promise<z.infer<typeof StoredTranscriptSchema>> {
  const object = await bucket.get(job.transcript_key);
  if (!object) {
    throw new ApiError(
      500,
      "transcript_missing",
      "The private transcript could not be found.",
    );
  }
  const parsed = StoredTranscriptSchema.safeParse(await object.json());
  if (!parsed.success || parsed.data.videoId !== job.video_id) {
    throw new ApiError(
      500,
      "transcript_invalid",
      "The private transcript failed integrity checks.",
    );
  }
  return parsed.data;
}

async function findLocalJob(
  db: D1Database,
  jobId: string,
  userId: string,
): Promise<LocalGenerationJob | null> {
  return db
    .prepare(
      "SELECT j.id, j.user_id, j.video_id, j.quiz_language, j.session_length, j.watched, j.transcript_key, j.question_types_json, j.state, j.cancel_requested, j.pipeline_version, v.title FROM generation_jobs j JOIN videos v ON v.id = j.video_id AND v.owner_id = j.user_id WHERE j.id = ? AND j.user_id = ?",
    )
    .bind(jobId, userId)
    .first<LocalGenerationJob>();
}

async function findOwnedJob(
  db: D1Database,
  jobId: string,
  userId: string,
): Promise<JobRow | null> {
  return db
    .prepare(
      "SELECT id, state, stage, progress, quiz_id, error_code, error_message, cancel_requested, pipeline_version FROM generation_jobs WHERE id = ? AND user_id = ?",
    )
    .bind(jobId, userId)
    .first<JobRow>();
}

async function findJobByIdempotencyKey(
  db: D1Database,
  userId: string,
  key: string,
): Promise<JobRow | null> {
  return db
    .prepare(
      "SELECT id, state, stage, progress, quiz_id, error_code, error_message, cancel_requested, pipeline_version FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?",
    )
    .bind(userId, key)
    .first<JobRow>();
}

function statusFromJob(job: JobRow) {
  return GenerationStatusSchema.parse({
    jobId: job.id,
    stage: GenerationStageSchema.parse(job.stage),
    progress: job.progress,
    quizId: job.quiz_id,
    error: job.error_code
      ? {
          code: job.error_code,
          message: job.error_message ?? "Generation failed.",
        }
      : null,
  });
}
