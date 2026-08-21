import {
  ExtensionQuizImportRequestSchema,
  ExtensionQuizImportResponseSchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  type ExtensionQuizImportRequest,
  type LocalConceptQuizQuestion,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const IdempotencyKeySchema = z.string().uuid();
const QUIZ_IMPORT_VERSION = "extension-quiz-import-v2" as const;

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
  const video = await c.env.DB.prepare(
    "SELECT id FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(input.videoId, user.id)
    .first<{ id: string }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  const quizId = createId();
  try {
    await persistImportedQuiz({
      db: c.env.DB,
      quizId,
      userId: user.id,
      importKey: idempotencyKey.data,
      input,
    });
  } catch (error) {
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

async function persistImportedQuiz(input: {
  db: D1Database;
  quizId: string;
  userId: string;
  importKey: string;
  input: ExtensionQuizImportRequest;
}): Promise<void> {
  const timestamp = now();
  const generatedQuiz = input.input.quiz;
  const questions = generatedQuiz.quiz.questions;
  const summary = {
    source: "extension-local-tool",
    importVersion: QUIZ_IMPORT_VERSION,
    pipelineVersion: LOCAL_QUIZ_PIPELINE_VERSION,
    model: LOCAL_QUIZ_MODEL,
    reasoningEffort: "high",
    promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
    validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
    qualityStatus: "passed",
    plannedCount: questions.length,
    passedCount: questions.length,
    transcriptStored: false,
    ...generatedQuiz.metrics,
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
        input.input.videoId,
        input.input.quizLanguage,
        input.input.sessionLength,
        generatedQuiz.quiz.title,
        JSON.stringify(
          questions.map((question) => ({
            id: question.id,
            title: question.concept,
            summary: question.concept,
            evidenceSegmentIds: [],
          })),
        ),
        input.input.watched ? 1 : 0,
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
        input.importKey,
        timestamp,
      ),
    ...questions.map((question, ordinal) =>
      questionInsert(
        input.db,
        input.quizId,
        question,
        ordinal,
        questions.length,
      ),
    ),
    input.db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(input.userId, input.input.videoId, timestamp),
  ];

  const results = await input.db.batch(statements);
  const questionResults = results.slice(1, 1 + questions.length);
  if (
    results.length !== statements.length ||
    results[0]?.meta.changes !== 1 ||
    questionResults.some((result) => result.meta.changes !== 1)
  ) {
    throw new ApiError(
      409,
      "quiz_import_rejected",
      "The extension quiz could not be stored atomically.",
    );
  }
}

function questionInsert(
  db: D1Database,
  quizId: string,
  question: LocalConceptQuizQuestion,
  ordinal: number,
  questionCount: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO questions
       (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
       VALUES (?, ?, ?, ?, 'multiple_choice', ?, ?, ?, ?, NULL, ?, NULL, ?, '[]', ?, ?)`,
    )
    .bind(
      createId(),
      quizId,
      ordinal,
      question.id,
      question.id,
      question.question,
      question.question,
      JSON.stringify(question.choices),
      JSON.stringify(question.answerIndex),
      question.explanation,
      assignedDifficulty(ordinal, questionCount),
      JSON.stringify({
        source: "extension-local-tool",
        blueprintSlot: question.id,
        concept: question.concept,
        model: LOCAL_QUIZ_MODEL,
        promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
        validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
        schemaValidated: true,
        transcriptStored: false,
      }),
    );
}

function assignedDifficulty(ordinal: number, questionCount: number): number {
  const position = (ordinal + 0.5) / questionCount;
  if (position < 0.2) return 1;
  if (position < 0.55) return 2;
  if (position < 0.85) return 3;
  return 4;
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
