import {
  GenerationStatusSchema,
  TranscriptUploadRequestSchema,
  TranscriptUploadResponseSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import type { GenerationQueueMessage } from "../types";

const MAX_TRANSCRIPT_CHARACTERS = 750_000;
const MAX_DEVICE_TRANSCRIPT_MS = 90 * 60 * 1_000;

type JobRow = {
  id: string;
  stage: string;
  progress: number;
  quiz_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

export const transcriptsRouter = new Hono<ApiBindings>();
export const generationRouter = new Hono<ApiBindings>();

transcriptsRouter.post("/", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.CACHE, {
    namespace: "transcript-upload",
    identifier: user.id,
    maximum: 8,
    windowSeconds: 60,
  });
  const input = await parseJson(c, TranscriptUploadRequestSchema);
  const video = await c.env.DB.prepare("SELECT id FROM videos WHERE id = ? AND owner_id = ?")
    .bind(input.videoId, user.id)
    .first<{ id: string }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  const ids = new Set<string>();
  let characterCount = 0;
  let previousStart = -1;
  for (const segment of input.segments) {
    if (ids.has(segment.id)) {
      throw new ApiError(422, "duplicate_segment_id", "Transcript segment IDs must be unique.");
    }
    if (segment.startMs < previousStart) {
      throw new ApiError(422, "unsorted_transcript", "Transcript segments must be sorted by start time.");
    }
    if (input.origin === "device_whisper" && segment.endMs > MAX_DEVICE_TRANSCRIPT_MS) {
      throw new ApiError(422, "transcript_too_long", "On-device transcripts are limited to 90 minutes.");
    }
    ids.add(segment.id);
    previousStart = segment.startMs;
    characterCount += segment.text.length;
  }
  if (characterCount > MAX_TRANSCRIPT_CHARACTERS) {
    throw new ApiError(413, "transcript_too_large", "This transcript is too large to create a trustworthy quiz.");
  }

  const idempotencyKey = c.req.header("idempotency-key");
  if (idempotencyKey) {
    const existingJobId = await c.env.CACHE.get(`idempotency:transcript:${user.id}:${idempotencyKey}`);
    if (existingJobId) {
      return c.json({ jobId: existingJobId, stage: "creating_questions" as const }, 202);
    }
  }

  const jobId = createId();
  const timestamp = now();
  const transcriptKey = `transcripts/${user.id}/${input.videoId}.json`;
  await c.env.PRIVATE_BUCKET.put(
    transcriptKey,
    JSON.stringify({
      version: 1,
      videoId: input.videoId,
      language: input.language,
      origin: input.origin,
      segments: input.segments,
    }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { ownerId: user.id, videoId: input.videoId, origin: input.origin },
    },
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO generation_jobs (id, user_id, video_id, state, stage, progress, quiz_language, session_length, watched, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'creating_questions', 0, ?, ?, ?, ?, ?)",
    ).bind(
      jobId,
      user.id,
      input.videoId,
      input.quizLanguage,
      input.sessionLength,
      input.watched ? 1 : 0,
      timestamp,
      timestamp,
    ),
    c.env.DB.prepare(
      "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
    ).bind(user.id, input.videoId, timestamp),
  ]);
  const status = TranscriptUploadResponseSchema.parse({ jobId, stage: "creating_questions" });
  await Promise.all([
    c.env.CACHE.put(`generation:${jobId}`, JSON.stringify({ ...status, progress: 0, quizId: null, error: null }), {
      expirationTtl: 3_600,
    }),
    c.env.GENERATION_QUEUE.send({ jobId, userId: user.id, videoId: input.videoId } satisfies GenerationQueueMessage),
    idempotencyKey
      ? c.env.CACHE.put(`idempotency:transcript:${user.id}:${idempotencyKey}`, jobId, { expirationTtl: 3_600 })
      : Promise.resolve(),
  ]);
  return c.json(status, 202);
});

generationRouter.get("/:jobId", async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("jobId");
  const cached = await c.env.CACHE.get(`generation:${jobId}`, "json");
  const cachedParsed = GenerationStatusSchema.safeParse(cached);
  if (cachedParsed.success) return c.json(cachedParsed.data);

  const job = await c.env.DB.prepare(
    "SELECT id, stage, progress, quiz_id, error_code, error_message FROM generation_jobs WHERE id = ? AND user_id = ?",
  )
    .bind(jobId, user.id)
    .first<JobRow>();
  if (!job) throw new ApiError(404, "generation_not_found", "Generation job not found.");
  const status = GenerationStatusSchema.parse({
    jobId: job.id,
    stage: job.stage,
    progress: job.progress,
    quizId: job.quiz_id,
    error: job.error_code ? { code: job.error_code, message: job.error_message ?? "Generation failed." } : null,
  });
  return c.json(status);
});
