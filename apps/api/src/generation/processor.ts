import { GenerationStatusSchema, LanguageSchema, SessionLengthSchema } from "@clipquest/contracts";
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
});

async function setStatus(
  env: AppEnv,
  input: {
    jobId: string;
    stage: "creating_questions" | "complete" | "failed";
    progress: number;
    quizId?: string | null;
    error?: { code: string; message: string } | null;
  },
): Promise<void> {
  const state = input.stage === "complete" ? "complete" : input.stage === "failed" ? "failed" : "running";
  await Promise.all([
    env.DB.prepare(
      "UPDATE generation_jobs SET state = ?, stage = ?, progress = ?, quiz_id = ?, error_code = ?, error_message = ?, updated_at = ?, generation_attempts = generation_attempts + 1 WHERE id = ?",
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
      .run(),
    env.CACHE.put(
      `generation:${input.jobId}`,
      JSON.stringify(
        GenerationStatusSchema.parse({
          jobId: input.jobId,
          stage: input.stage,
          progress: input.progress,
          quizId: input.quizId ?? null,
          error: input.error ?? null,
        }),
      ),
      { expirationTtl: 3_600 },
    ),
  ]);
}

export async function processGeneration(env: AppEnv, message: GenerationQueueMessage): Promise<void> {
  await setStatus(env, { jobId: message.jobId, stage: "creating_questions", progress: 0.08 });
  const row = await env.DB.prepare(
    "SELECT j.id, j.user_id, j.video_id, j.quiz_language, j.session_length, j.watched, v.title FROM generation_jobs j JOIN videos v ON v.id = j.video_id WHERE j.id = ? AND j.user_id = ? AND j.video_id = ?",
  )
    .bind(message.jobId, message.userId, message.videoId)
    .first();
  const job = JobSchema.safeParse(row);
  if (!job.success) throw new ApiError(404, "generation_not_found", "Generation job not found.");

  const transcriptObject = await env.PRIVATE_BUCKET.get(
    `transcripts/${job.data.user_id}/${job.data.video_id}.json`,
  );
  if (!transcriptObject) throw new ApiError(500, "transcript_missing", "The private transcript could not be found.");
  const transcript = StoredTranscriptSchema.safeParse(await transcriptObject.json());
  if (!transcript.success) {
    throw new ApiError(500, "transcript_invalid", "The private transcript failed integrity checks.");
  }

  await setStatus(env, { jobId: message.jobId, stage: "creating_questions", progress: 0.2 });
  const classification = await classifyTranscript(env, job.data.title, transcript.data.segments);
  if (!classification.educational) {
    await env.DB.prepare("UPDATE videos SET education_status = 'rejected', updated_at = ? WHERE id = ?")
      .bind(now(), job.data.video_id)
      .run();
    throw new ApiError(
      422,
      "not_educational",
      `ClipQuest could not find enough teachable evidence in this video: ${classification.reason}`,
    );
  }
  await env.DB.prepare("UPDATE videos SET education_status = 'educational', updated_at = ? WHERE id = ?")
    .bind(now(), job.data.video_id)
    .run();

  await setStatus(env, { jobId: message.jobId, stage: "creating_questions", progress: 0.42 });
  const generation = await generateQuiz(env, {
    title: job.data.title,
    language: job.data.quiz_language,
    sessionLength: job.data.session_length,
    watched: Boolean(job.data.watched),
    segments: transcript.data.segments,
  });
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
  ];
  await env.DB.batch(statements);
  await setStatus(env, { jobId: message.jobId, stage: "complete", progress: 1, quizId });
}

export async function failGeneration(env: AppEnv, jobId: string, error: unknown): Promise<void> {
  const apiError = error instanceof ApiError ? error : null;
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

