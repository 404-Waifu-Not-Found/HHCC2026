import {
  ExtensionQuizChunkAppendRequestSchema,
  ExtensionQuizGenerationProgressRequestSchema,
  ExtensionQuizImportRequestSchema,
  ExtensionQuizImportResponseSchema,
  ExtensionQuizProgressiveImportRequestSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
  type ExtensionQuizImportRequest,
  type ExtensionQuizProgressiveImportRequest,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizQuestionChunk,
  questionTypePlanForSelection,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { requireIdempotencyKey } from "../lib/idempotency";
import { enforceRateLimit } from "../lib/rate-limit";
import {
  ProgressiveQuizSummarySchema,
  acceptedQuestionSummary,
  assertProgressiveChunkMetadata,
  readProgressiveGenerationSnapshot,
  tryProgressiveQuizSummary,
  type ProgressiveQuizSummary,
} from "../lib/progressive-quiz";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const QUIZ_IMPORT_VERSION = "extension-quiz-import-v3" as const;

export const quizImportsRouter = new Hono<ApiBindings>();

quizImportsRouter.post("/progressive", async (c) => {
  const user = c.get("user");
  const importKey = requireIdempotencyKey(c);
  const existing = await findProgressiveImportedQuiz(
    c.env.DB,
    user.id,
    importKey,
  );
  if (existing) {
    return c.json(
      ExtensionQuizProgressiveImportResponseSchema.parse(
        await progressiveImportState(c.env.DB, existing.id),
      ),
    );
  }

  await enforceRateLimit(c.env.DB, {
    namespace: "extension-progressive-import",
    identifier: user.id,
    maximum: 8,
    windowSeconds: 60,
  });
  const input = await parseJson(c, ExtensionQuizProgressiveImportRequestSchema);
  if (input.chunk.startIndex !== 0) {
    throw new ApiError(
      409,
      "quiz_question_out_of_sequence",
      "Progressive import must begin with question one.",
    );
  }
  await requireOwnedVideo(c.env.DB, input.videoId, user.id);

  const quizId = createId();
  try {
    await persistProgressiveQuiz({
      db: c.env.DB,
      quizId,
      userId: user.id,
      importKey,
      input,
    });
  } catch (error) {
    const raced = await findProgressiveImportedQuiz(
      c.env.DB,
      user.id,
      importKey,
    );
    if (!raced) throw error;
    return c.json(
      ExtensionQuizProgressiveImportResponseSchema.parse(
        await progressiveImportState(c.env.DB, raced.id),
      ),
    );
  }

  return c.json(
    ExtensionQuizProgressiveImportResponseSchema.parse(
      await progressiveImportState(c.env.DB, quizId),
    ),
    201,
  );
});

quizImportsRouter.put("/:quizId/questions", async (c) => {
  const user = c.get("user");
  const importKey = requireIdempotencyKey(c);
  await enforceRateLimit(c.env.DB, {
    namespace: "extension-progressive-question",
    identifier: user.id,
    maximum: 45,
    windowSeconds: 60,
  });
  const input = await parseJson(c, ExtensionQuizChunkAppendRequestSchema);
  const bank = await progressiveBank(
    c.env.DB,
    c.req.param("quizId"),
    user.id,
    importKey,
  );
  const snapshot = await readProgressiveGenerationSnapshot(c.env.DB, bank.id);
  const summary = snapshot.summary;
  if (!summary || !snapshot.availability) {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This quiz does not support current progressive question delivery.",
    );
  }
  assertProgressiveChunkMetadata(summary, input.chunk);
  if (input.chunk.totalQuestions !== summary.plannedCount) {
    throw new ApiError(
      409,
      "quiz_question_mismatch",
      "The question does not match this quiz's planned total.",
    );
  }
  const expectedTypes = questionTypePlanForSelection(
    summary.requestedQuestionTypes,
    summary.plannedCount,
  );
  if (input.chunk.question.type !== expectedTypes[input.chunk.startIndex]) {
    throw new ApiError(
      422,
      "quiz_question_type_mismatch",
      "The streamed question did not match the requested type plan.",
    );
  }
  const state = progressiveImportStateFromSnapshot(snapshot);
  if (input.chunk.startIndex < snapshot.authoritativeCount) {
    if (
      await storedQuestionMatches(
        c.env.DB,
        bank.id,
        input.chunk.startIndex,
        input.chunk.question,
      )
    ) {
      await reconcileAttemptItems(c.env.DB, bank.id);
      return c.json(ExtensionQuizProgressiveImportResponseSchema.parse(state));
    }
    throw new ApiError(
      409,
      "quiz_question_conflict",
      "That question position was already stored with different content.",
    );
  }
  if (input.chunk.startIndex !== snapshot.authoritativeCount) {
    throw new ApiError(
      409,
      "quiz_question_out_of_sequence",
      "Questions must be uploaded in global order.",
    );
  }
  const normalizedPrompt = input.chunk.question.question
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  if (
    summary.acceptedQuestionSummaries.some(
      (question) =>
        question.question.normalize("NFKC").toLocaleLowerCase().trim() ===
        normalizedPrompt,
    )
  ) {
    throw new ApiError(
      422,
      "quiz_question_duplicate",
      "The streamed question duplicates an accepted prompt.",
    );
  }

  const nextCount = input.chunk.startIndex + 1;
  const complete = nextCount === summary.plannedCount;
  const questionId = createId();
  const timestamp = now();
  const nextSummary = ProgressiveQuizSummarySchema.parse({
    ...summary,
    generationState: complete ? "ready" : "generating",
    reasonCode: undefined,
    generatedQuestionTypes: [
      ...summary.generatedQuestionTypes,
      input.chunk.question.type,
    ],
    acceptedCount: nextCount,
    lastProgressAt: timestamp,
    acceptedQuestionSummaries: [
      ...summary.acceptedQuestionSummaries,
      acceptedQuestionSummary(input.chunk.question),
    ],
    aiCalls: summary.aiCalls + input.chunk.metrics.aiCalls,
    retryCount: summary.retryCount + input.chunk.metrics.retryCount,
    inputTokens: summary.inputTokens + input.chunk.metrics.inputTokens,
    outputTokens: summary.outputTokens + input.chunk.metrics.outputTokens,
    reasoningTokens:
      summary.reasoningTokens + input.chunk.metrics.reasoningTokens,
    elapsedMs: summary.elapsedMs + input.chunk.metrics.elapsedMs,
  });
  const conceptsJson = JSON.stringify(
    nextSummary.acceptedQuestionSummaries.map((question) => ({
      id: question.id,
      title: question.concept,
      summary: question.concept,
      evidenceSegmentIds: [],
    })),
  );

  try {
    const results = await c.env.DB.batch([
      questionInsert(
        c.env.DB,
        bank.id,
        input.chunk.question,
        input.chunk.startIndex,
        summary.plannedCount,
        input.chunk,
        questionId,
      ),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO attempt_items (attempt_id, ordinal, question_id) SELECT id, ?, ? FROM attempts WHERE quiz_id = ?",
      ).bind(input.chunk.startIndex, questionId, bank.id),
      c.env.DB.prepare(
        "UPDATE quiz_banks SET quality_status = ?, quality_summary_json = ?, concepts_json = ? WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'generating'",
      ).bind(
        complete ? "passed" : "generating",
        JSON.stringify(nextSummary),
        conceptsJson,
        bank.id,
        user.id,
        importKey,
        LOCAL_QUIZ_PIPELINE_VERSION,
      ),
    ]);
    if (results[0]?.meta.changes !== 1 || results[2]?.meta.changes !== 1) {
      throw new Error("Progressive question write lost its reservation.");
    }
  } catch (error) {
    if (
      await storedQuestionMatches(
        c.env.DB,
        bank.id,
        input.chunk.startIndex,
        input.chunk.question,
      )
    ) {
      await reconcileAttemptItems(c.env.DB, bank.id);
      return c.json(
        ExtensionQuizProgressiveImportResponseSchema.parse(
          await progressiveImportState(c.env.DB, bank.id),
        ),
      );
    }
    throw error;
  }

  await reconcileAttemptItems(c.env.DB, bank.id);
  return c.json(
    ExtensionQuizProgressiveImportResponseSchema.parse(
      await progressiveImportState(c.env.DB, bank.id),
    ),
  );
});

quizImportsRouter.patch("/:quizId/progress", async (c) => {
  const user = c.get("user");
  const importKey = requireIdempotencyKey(c);
  const input = await parseJson(
    c,
    ExtensionQuizGenerationProgressRequestSchema,
  );
  const bank = await progressiveBank(
    c.env.DB,
    c.req.param("quizId"),
    user.id,
    importKey,
  );
  const snapshot = await readProgressiveGenerationSnapshot(c.env.DB, bank.id);
  if (snapshot.qualityStatus !== "passed") {
    const summary = snapshot.summary;
    if (!summary) {
      throw new ApiError(
        409,
        "quiz_not_progressive",
        "This quiz does not support current progressive question delivery.",
      );
    }
    const nextSummary = ProgressiveQuizSummarySchema.parse({
      ...summary,
      generationState: input.state,
      reasonCode: input.reasonCode,
      lastProgressAt: now(),
    });
    await c.env.DB.prepare(
      "UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'generating' AND quality_summary_json = ?",
    )
      .bind(
        JSON.stringify(nextSummary),
        bank.id,
        user.id,
        importKey,
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
      )
      .run();
  }
  return c.json(
    ExtensionQuizProgressiveImportResponseSchema.parse(
      await progressiveImportState(c.env.DB, bank.id),
    ),
  );
});

quizImportsRouter.post("/", async (c) => {
  const user = c.get("user");
  const idempotencyKey = requireIdempotencyKey(c);

  const existing = await findImportedQuiz(c.env.DB, user.id, idempotencyKey);
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
      importKey: idempotencyKey,
      input,
    });
  } catch (error) {
    const raced = await findImportedQuiz(c.env.DB, user.id, idempotencyKey);
    if (raced) {
      return c.json(
        ExtensionQuizImportResponseSchema.parse({ quizId: raced.id }),
      );
    }
    throw error;
  }

  return c.json(ExtensionQuizImportResponseSchema.parse({ quizId }), 201);
});

async function requireOwnedVideo(
  db: D1Database,
  videoId: string,
  userId: string,
): Promise<void> {
  const video = await db
    .prepare("SELECT id FROM videos WHERE id = ? AND owner_id = ?")
    .bind(videoId, userId)
    .first<{ id: string }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");
}

async function persistProgressiveQuiz(input: {
  db: D1Database;
  quizId: string;
  userId: string;
  importKey: string;
  input: ExtensionQuizProgressiveImportRequest;
}): Promise<void> {
  const timestamp = now();
  const chunk = input.input.chunk;
  const question = chunk.question;
  const summary = ProgressiveQuizSummarySchema.parse({
    source: "extension-local-json-stream",
    importVersion: LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
    pipelineVersion: chunk.pipelineVersion,
    model: chunk.model,
    reasoningEffort: "high",
    promptVersion: chunk.promptVersion,
    validatorVersion: chunk.validatorVersion,
    generationState: "generating",
    requestedQuestionTypes: input.input.questionTypes,
    generatedQuestionTypes: [question.type],
    plannedCount: chunk.totalQuestions,
    acceptedCount: 1,
    lastProgressAt: timestamp,
    acceptedQuestionSummaries: [acceptedQuestionSummary(question)],
    transcriptStored: false,
    ...chunk.metrics,
  });
  const statements = [
    input.db
      .prepare(
        `INSERT INTO quiz_banks
         (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, import_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?, ?)`,
      )
      .bind(
        input.quizId,
        input.userId,
        input.input.videoId,
        input.input.quizLanguage,
        input.input.sessionLength,
        chunk.title,
        JSON.stringify([
          {
            id: question.id,
            title: question.concept,
            summary: question.concept,
            evidenceSegmentIds: [],
          },
        ]),
        input.input.watched ? 1 : 0,
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
        input.importKey,
        timestamp,
      ),
    questionInsert(
      input.db,
      input.quizId,
      question,
      0,
      chunk.totalQuestions,
      chunk,
    ),
    input.db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(input.userId, input.input.videoId, timestamp),
  ];
  const results = await input.db.batch(statements);
  if (
    results.length !== statements.length ||
    results[0]?.meta.changes !== 1 ||
    results[1]?.meta.changes !== 1
  ) {
    throw new ApiError(
      409,
      "quiz_import_rejected",
      "The first streamed question could not be stored atomically.",
    );
  }
}

async function findProgressiveImportedQuiz(
  db: D1Database,
  userId: string,
  importKey: string,
): Promise<{ id: string } | null> {
  const result = await db
    .prepare(
      "SELECT id, quality_summary_json FROM quiz_banks WHERE user_id = ? AND import_key = ? AND pipeline_version = ? LIMIT 1",
    )
    .bind(userId, importKey, LOCAL_QUIZ_PIPELINE_VERSION)
    .first<{ id: string; quality_summary_json: string }>();
  return result && tryProgressiveQuizSummary(result.quality_summary_json)
    ? { id: result.id }
    : null;
}

type ProgressiveBank = {
  id: string;
};

async function progressiveBank(
  db: D1Database,
  quizId: string,
  userId: string,
  importKey: string,
): Promise<ProgressiveBank> {
  const bank = await db
    .prepare(
      "SELECT id FROM quiz_banks WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ?",
    )
    .bind(quizId, userId, importKey, LOCAL_QUIZ_PIPELINE_VERSION)
    .first<ProgressiveBank>();
  if (!bank) throw new ApiError(404, "quiz_not_found", "Quiz not found.");
  return bank;
}

async function progressiveImportState(db: D1Database, quizId: string) {
  return progressiveImportStateFromSnapshot(
    await readProgressiveGenerationSnapshot(db, quizId),
  );
}

function progressiveImportStateFromSnapshot(
  snapshot: Awaited<ReturnType<typeof readProgressiveGenerationSnapshot>>,
) {
  if (
    snapshot.pipelineVersion !== LOCAL_QUIZ_PIPELINE_VERSION ||
    !snapshot.summary ||
    !snapshot.availability
  ) {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This quiz does not support current progressive question delivery.",
    );
  }
  return {
    quizId: snapshot.quizId,
    generation: snapshot.availability,
  };
}

async function storedQuestionMatches(
  db: D1Database,
  quizId: string,
  ordinal: number,
  question: LocalConceptQuizQuestion,
): Promise<boolean> {
  const stored = await db
    .prepare(
      "SELECT source_question_id, type, prompt, options_json, correct_answer_json, rubric_json, explanation, generation_metadata_json FROM questions WHERE quiz_id = ? AND ordinal = ?",
    )
    .bind(quizId, ordinal)
    .first<{
      source_question_id: string;
      type: string;
      prompt: string;
      options_json: string | null;
      correct_answer_json: string | null;
      rubric_json: string | null;
      explanation: string;
      generation_metadata_json: string;
    }>();
  if (!stored) return false;
  const expected = storedQuestionFields(question);
  let concept: unknown;
  try {
    concept = z
      .object({ concept: z.string() })
      .passthrough()
      .parse(JSON.parse(stored.generation_metadata_json)).concept;
  } catch {
    return false;
  }
  return (
    stored.source_question_id === question.id &&
    stored.type === question.type &&
    stored.prompt === question.question &&
    stored.options_json === expected.optionsJson &&
    stored.correct_answer_json === expected.correctAnswerJson &&
    stored.rubric_json === expected.rubricJson &&
    stored.explanation === expected.explanation &&
    concept === question.concept
  );
}

export async function reconcileAttemptItems(
  db: D1Database,
  quizId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO attempt_items (attempt_id, ordinal, question_id) SELECT a.id, q.ordinal, q.id FROM attempts a JOIN questions q ON q.quiz_id = a.quiz_id WHERE a.quiz_id = ?",
    )
    .bind(quizId)
    .run();
}

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
    pipelineVersion: generatedQuiz.pipelineVersion,
    model: generatedQuiz.model,
    reasoningEffort: "high",
    promptVersion: generatedQuiz.promptVersion,
    validatorVersion: generatedQuiz.validatorVersion,
    qualityStatus: "passed",
    requestedQuestionTypes: input.input.questionTypes,
    generatedQuestionTypes: questions.map((question) => question.type),
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
        generatedQuiz,
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
  metadata: Pick<
    LocalConceptQuizQuestionChunk,
    "pipelineVersion" | "model" | "promptVersion" | "validatorVersion"
  >,
  questionId = createId(),
): D1PreparedStatement {
  const stored = storedQuestionFields(question);
  return db
    .prepare(
      `INSERT INTO questions
       (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, ?)`,
    )
    .bind(
      questionId,
      quizId,
      ordinal,
      question.id,
      question.type,
      question.id,
      question.question,
      question.question,
      stored.optionsJson,
      stored.correctAnswerJson,
      stored.rubricJson,
      stored.explanation,
      assignedDifficulty(ordinal, questionCount),
      JSON.stringify({
        source: "extension-local-tool",
        blueprintSlot: question.id,
        concept: question.concept,
        questionType: question.type,
        pipelineVersion: metadata.pipelineVersion,
        model: metadata.model,
        promptVersion: metadata.promptVersion,
        validatorVersion: metadata.validatorVersion,
        schemaValidated: true,
        transcriptStored: false,
      }),
    );
}

export function storedQuestionFields(question: LocalConceptQuizQuestion): {
  optionsJson: string | null;
  correctAnswerJson: string | null;
  rubricJson: string | null;
  explanation: string;
} {
  if (question.type === "multiple_choice") {
    return {
      optionsJson: JSON.stringify(question.choices),
      correctAnswerJson: JSON.stringify(question.answerIndex),
      rubricJson: null,
      explanation: question.explanation,
    };
  }
  if (question.type === "true_false") {
    return {
      optionsJson: null,
      correctAnswerJson: JSON.stringify(question.answer),
      rubricJson: null,
      explanation: question.answer
        ? question.explanation
        : `${question.correction} ${question.explanation}`,
    };
  }
  return {
    optionsJson: null,
    correctAnswerJson: null,
    rubricJson: JSON.stringify({
      requiredIdeas: question.rubricIdeas,
      acceptableAlternatives: [question.answer, ...question.acceptableAnswers],
    }),
    explanation: question.explanation,
  };
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
