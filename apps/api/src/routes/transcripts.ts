import {
  GenerationStageSchema,
  GenerationStatusSchema,
  TranscriptUploadRequestSchema,
  TranscriptUploadResponseSchema,
} from "@clipquest/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  failGeneration,
  prepareGenerationRetry,
  processGeneration,
} from "../generation/processor";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import type { AppEnv, GenerationQueueMessage } from "../types";

const MAX_TRANSCRIPT_CHARACTERS = 750_000;
const MAX_DEVICE_TRANSCRIPT_MS = 90 * 60 * 1_000;

type JobRow = {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  stage: string;
  progress: number;
  quiz_id: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
};

const IdempotencyKeySchema = z.string().uuid();

export const transcriptsRouter = new Hono<ApiBindings>();
export const generationRouter = new Hono<ApiBindings>();

transcriptsRouter.post("/", async (c) => {
  const uploadStartedAt = Date.now();
  const requestId = crypto.randomUUID();
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
    if (existing.state === "queued") {
      startGeneration(c, {
        jobId: existing.id,
        userId: user.id,
        videoId: await getJobVideoId(c.env.DB, existing.id, user.id),
      });
    }
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
    "SELECT id FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(input.videoId, user.id)
    .first<{ id: string }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

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
  if (characterCount > MAX_TRANSCRIPT_CHARACTERS) {
    throw new ApiError(
      413,
      "transcript_too_large",
      "This transcript is too large to create a trustworthy quiz.",
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
  console.info(
    JSON.stringify({
      scope: "transcript_upload",
      event: "text_stored",
      requestId,
      jobId,
      origin: input.origin,
      acquisition: input.acquisition ?? "unspecified",
      segmentCount: input.segments.length,
      characterCount,
      elapsedMs: Date.now() - uploadStartedAt,
    }),
  );
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO generation_jobs (id, user_id, video_id, state, stage, progress, quiz_language, session_length, watched, transcript_key, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'creating_questions', 0, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        jobId,
        user.id,
        input.videoId,
        input.quizLanguage,
        input.sessionLength,
        input.watched ? 1 : 0,
        transcriptKey,
        idempotencyKey.data,
        timestamp,
        timestamp,
      ),
      c.env.DB.prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      ).bind(user.id, input.videoId, timestamp),
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
  const status = TranscriptUploadResponseSchema.parse({
    jobId,
    stage: "creating_questions",
  });
  startGeneration(c, { jobId, userId: user.id, videoId: input.videoId });
  console.info(
    JSON.stringify({
      scope: "transcript_upload",
      event: "generation_started",
      requestId,
      jobId,
      elapsedMs: Date.now() - uploadStartedAt,
    }),
  );
  return c.json(status, 202);
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

generationRouter.get("/:jobId", async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("jobId");
  const job = await findOwnedJob(c.env.DB, jobId, user.id);
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
  if (!job)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  if (job.state === "complete") return c.json(statusFromJob(job));
  if (job.cancel_requested || job.error_code === "generation_cancelled") {
    throw new ApiError(
      409,
      "generation_cancelled",
      "This generation was cancelled. Start a new quiz instead.",
    );
  }
  if (job.state === "failed") {
    await c.env.DB.prepare(
      "UPDATE generation_jobs SET state = 'queued', stage = 'creating_questions', progress = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'failed' AND cancel_requested = 0",
    )
      .bind(now(), job.id, user.id)
      .run();
  }
  const queuedStatus = GenerationStatusSchema.parse({
    jobId: job.id,
    stage: "creating_questions",
    progress: 0,
    quizId: null,
    error: null,
  });
  startGeneration(c, {
    jobId: job.id,
    userId: user.id,
    videoId: await getJobVideoId(c.env.DB, job.id, user.id),
  });
  return c.json(queuedStatus, 202);
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
  const status = GenerationStatusSchema.parse({
    jobId: job.id,
    stage: "failed",
    progress: 1,
    quizId: null,
    error: {
      code: "generation_cancelled",
      message: "Quiz creation was cancelled.",
    },
  });
  await c.env.DB.prepare(
    "UPDATE generation_jobs SET state = 'failed', stage = 'failed', progress = 1, cancel_requested = 1, error_code = 'generation_cancelled', error_message = 'Quiz creation was cancelled.', updated_at = ? WHERE id = ? AND user_id = ? AND state != 'complete'",
  )
    .bind(now(), job.id, user.id)
    .run();
  return c.json(status);
});

async function findOwnedJob(
  db: D1Database,
  jobId: string,
  userId: string,
): Promise<JobRow | null> {
  return db
    .prepare(
      "SELECT id, state, stage, progress, quiz_id, error_code, error_message, cancel_requested FROM generation_jobs WHERE id = ? AND user_id = ?",
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
      "SELECT id, state, stage, progress, quiz_id, error_code, error_message, cancel_requested FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?",
    )
    .bind(userId, key)
    .first<JobRow>();
}

async function getJobVideoId(
  db: D1Database,
  jobId: string,
  userId: string,
): Promise<string> {
  const row = await db
    .prepare(
      "SELECT video_id FROM generation_jobs WHERE id = ? AND user_id = ?",
    )
    .bind(jobId, userId)
    .first<{ video_id: string }>();
  if (!row)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );
  return row.video_id;
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

function startGeneration(
  c: Context<ApiBindings>,
  message: GenerationQueueMessage,
) {
  console.info(
    JSON.stringify({
      scope: "generation_fast_path",
      event: "started",
      jobId: message.jobId,
    }),
  );
  c.executionCtx.waitUntil(runGenerationFastPath(c.env, message));
}

async function runGenerationFastPath(
  env: AppEnv,
  message: GenerationQueueMessage,
): Promise<void> {
  try {
    await processGeneration(env, message);
    console.info(
      JSON.stringify({
        scope: "generation_fast_path",
        event: "completed",
        jobId: message.jobId,
      }),
    );
  } catch (error) {
    const nonRetryable = error instanceof ApiError && error.status === 422;
    console.error(
      JSON.stringify({
        scope: "generation_fast_path",
        event: "failed",
        jobId: message.jobId,
        errorCode: error instanceof ApiError ? error.code : "generation_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        nonRetryable,
      }),
    );
    if (nonRetryable) {
      await failGeneration(env, message.jobId, error);
      return;
    }
    const prepared = await prepareGenerationRetry(env, message.jobId);
    if (prepared) await env.GENERATION_QUEUE.send(message);
    else await failGeneration(env, message.jobId, error);
  }
}
