import { LanguageSchema, SessionLengthSchema } from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import type { AppEnv, GenerationQueueMessage } from "../types";
import {
  StoredTranscriptSchema,
  classifyTranscript,
  generateQuiz,
  questionStorageFields,
} from "./deepseek";

const JobSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  video_id: z.string().uuid(),
  quiz_language: LanguageSchema,
  session_length: SessionLengthSchema,
  watched: z.number().int(),
  title: z.string(),
  transcript_key: z.string().min(1),
});

function logGeneration(
  event: string,
  jobId: string,
  details: Record<string, unknown> = {},
  level: "info" | "warn" = "info",
) {
  console[level](
    JSON.stringify({ scope: "generation", event, jobId, ...details }),
  );
}

async function setStatus(
  env: AppEnv,
  input: {
    jobId: string;
    stage: "creating_questions" | "complete" | "failed";
    progress: number;
    quizId?: string | null;
    error?: { code: string; message: string } | null;
  },
): Promise<boolean> {
  const state =
    input.stage === "complete"
      ? "complete"
      : input.stage === "failed"
        ? "failed"
        : "running";
  const updated = await env.DB.prepare(
    "UPDATE generation_jobs SET state = ?, stage = ?, progress = ?, quiz_id = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND cancel_requested = 0 AND state != 'complete'",
  )
    .bind(
      state,
      input.stage,
      input.progress,
      input.quizId ?? null,
      input.error?.code ?? null,
      input.error?.message ?? null,
      now(),
      input.jobId,
    )
    .run();
  return Boolean(updated.meta.changes);
}

export async function processGeneration(
  env: AppEnv,
  message: GenerationQueueMessage,
): Promise<void> {
  const startedAt = Date.now();
  logGeneration("job.received", message.jobId, { videoId: message.videoId });
  const claimed = await env.DB.prepare(
    "UPDATE generation_jobs SET state = 'running', stage = 'creating_questions', progress = 0.08, error_code = NULL, error_message = NULL, generation_attempts = generation_attempts + 1, updated_at = ? WHERE id = ? AND user_id = ? AND video_id = ? AND state = 'queued' AND cancel_requested = 0",
  )
    .bind(now(), message.jobId, message.userId, message.videoId)
    .run();
  if (!claimed.meta.changes) {
    logGeneration("job.skipped", message.jobId, {
      reason: "not_claimed",
      elapsedMs: Date.now() - startedAt,
    });
    return;
  }
  logGeneration("job.claimed", message.jobId, {
    elapsedMs: Date.now() - startedAt,
  });
  const row = await env.DB.prepare(
    "SELECT j.id, j.user_id, j.video_id, j.quiz_language, j.session_length, j.watched, j.transcript_key, v.title FROM generation_jobs j JOIN videos v ON v.id = j.video_id WHERE j.id = ? AND j.user_id = ? AND j.video_id = ?",
  )
    .bind(message.jobId, message.userId, message.videoId)
    .first();
  const job = JobSchema.safeParse(row);
  if (!job.success)
    throw new ApiError(
      404,
      "generation_not_found",
      "Generation job not found.",
    );

  const transcriptObject = await env.PRIVATE_BUCKET.get(
    job.data.transcript_key,
  );
  if (!transcriptObject)
    throw new ApiError(
      500,
      "transcript_missing",
      "The private transcript could not be found.",
    );
  const transcript = StoredTranscriptSchema.safeParse(
    await transcriptObject.json(),
  );
  if (!transcript.success) {
    throw new ApiError(
      500,
      "transcript_invalid",
      "The private transcript failed integrity checks.",
    );
  }
  logGeneration("transcript.loaded", message.jobId, {
    elapsedMs: Date.now() - startedAt,
    origin: transcript.data.origin,
    segmentCount: transcript.data.segments.length,
  });

  if (
    !(await setStatus(env, {
      jobId: message.jobId,
      stage: "creating_questions",
      progress: 0.2,
    }))
  )
    return;
  const modelStartedAt = Date.now();
  logGeneration("model.started", message.jobId, {
    language: job.data.quiz_language,
    sessionLength: job.data.session_length,
  });
  const [classification, generation] = await Promise.all([
    classifyTranscript(env, job.data.title, transcript.data.segments),
    generateQuiz(env, {
      title: job.data.title,
      language: job.data.quiz_language,
      sessionLength: job.data.session_length,
      watched: Boolean(job.data.watched),
      segments: transcript.data.segments,
    }),
  ]);
  logGeneration("model.completed", message.jobId, {
    educational: classification.educational,
    elapsedMs: Date.now() - modelStartedAt,
    questionCount: generation.questions.length,
  });
  if (!classification.educational) {
    await env.DB.prepare(
      "UPDATE videos SET education_status = 'rejected', updated_at = ? WHERE id = ?",
    )
      .bind(now(), job.data.video_id)
      .run();
    throw new ApiError(
      422,
      "not_educational",
      `ClipQuest could not find enough teachable evidence in this video: ${classification.reason}`,
    );
  }
  await env.DB.prepare(
    "UPDATE videos SET education_status = 'educational', updated_at = ? WHERE id = ?",
  )
    .bind(now(), job.data.video_id)
    .run();

  if (
    !(await setStatus(env, {
      jobId: message.jobId,
      stage: "creating_questions",
      progress: 0.9,
    }))
  )
    return;
  const quizId = createId();
  const timestamp = now();
  const statements = [
    env.DB.prepare(
      "INSERT INTO quiz_banks (id, user_id, video_id, language, session_length, primer, concepts_json, watched, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      quizId,
      job.data.user_id,
      job.data.video_id,
      job.data.quiz_language,
      job.data.session_length,
      generation.primer,
      JSON.stringify(generation.concepts),
      job.data.watched,
      timestamp,
    ),
    ...generation.questions.map((question, index) => {
      const stored = questionStorageFields(question);
      return env.DB.prepare(
        "INSERT INTO questions (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        createId(),
        quizId,
        index,
        question.id,
        question.type,
        question.conceptId,
        question.prompt,
        question.reformulatedPrompt,
        stored.optionsJson,
        stored.itemsJson,
        stored.correctAnswerJson,
        stored.rubricJson,
        question.explanation,
        JSON.stringify(question.evidenceSegmentIds),
        question.difficulty,
      );
    }),
    env.DB.prepare(
      "UPDATE generation_jobs SET state = 'complete', stage = 'complete', progress = 1, quiz_id = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND state = 'running' AND cancel_requested = 0",
    ).bind(quizId, timestamp, message.jobId),
  ];
  const commitStartedAt = Date.now();
  logGeneration("d1.commit_started", message.jobId, {
    statementCount: statements.length,
    questionCount: generation.questions.length,
  });
  const results = await env.DB.batch(statements);
  if (!results.at(-1)?.meta.changes) {
    await env.DB.prepare("DELETE FROM quiz_banks WHERE id = ?")
      .bind(quizId)
      .run();
    logGeneration(
      "job.cancelled_before_commit",
      message.jobId,
      { elapsedMs: Date.now() - startedAt },
      "warn",
    );
    return;
  }
  logGeneration("d1.commit_completed", message.jobId, {
    elapsedMs: Date.now() - commitStartedAt,
    statementCount: statements.length,
  });
  logGeneration("job.completed", message.jobId, {
    elapsedMs: Date.now() - startedAt,
    quizId,
    questionCount: generation.questions.length,
  });
}

export async function failGeneration(
  env: AppEnv,
  jobId: string,
  error: unknown,
): Promise<void> {
  const apiError = error instanceof ApiError ? error : null;
  logGeneration(
    "job.failed",
    jobId,
    {
      errorCode: apiError?.code ?? "generation_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    "warn",
  );
  await setStatus(env, {
    jobId,
    stage: "failed",
    progress: 1,
    error: {
      code: apiError?.code ?? "generation_failed",
      message:
        apiError?.message ??
        "Couldn’t create a trustworthy quiz from this video. Try another video or transcript.",
    },
  });
}

export async function prepareGenerationRetry(
  env: AppEnv,
  jobId: string,
): Promise<boolean> {
  const updated = await env.DB.prepare(
    "UPDATE generation_jobs SET state = 'queued', stage = 'creating_questions', progress = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND state = 'running' AND cancel_requested = 0",
  )
    .bind(now(), jobId)
    .run();
  logGeneration(
    "job.retry_prepared",
    jobId,
    { prepared: Boolean(updated.meta.changes) },
    "warn",
  );
  return Boolean(updated.meta.changes);
}
