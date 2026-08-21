import {
  ExtensionQuizChunkAppendRequestSchema,
  ExtensionQuizGenerationCallEventRequestSchema,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizGenerationProgressRequestSchema,
  ExtensionQuizImportRequestSchema,
  ExtensionQuizImportResponseSchema,
  ExtensionQuizProgressiveImportRequestSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
  type ExtensionQuizImportRequest,
  type ExtensionQuizProgressiveImportRequest,
  type LocalGenerationCallEvent,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizQuestionChunk,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { stableQuizGenerationEnabled } from "../lib/generation-rollout";
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
const GENERATION_CLAIM_LEASE_MS = 15 * 60 * 1_000;

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
  if (
    input.chunk.generationProfile === "stable_non_thinking_v5_2" &&
    !stableQuizGenerationEnabled(c.env, user.id)
  ) {
    throw new ApiError(
      403,
      "quiz_generation_profile_disabled",
      "The stable generation profile is not enabled for this account yet.",
    );
  }
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
  if (
    input.chunk.question.type !==
    summary.plannedQuestionTypes[input.chunk.startIndex]
  ) {
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
        promptSimilarity(question.question, normalizedPrompt) >= 0.9,
    )
  ) {
    throw new ApiError(
      422,
      "quiz_question_duplicate",
      "The streamed question duplicates an accepted prompt.",
    );
  }

  const nextCount = input.chunk.startIndex + 1;
  const qualityFlags = questionQualityFlags(
    input.chunk.question,
    summary.acceptedQuestionSummaries,
  );
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
    lastQuestionAt: timestamp,
    stateChangedAt:
      summary.generationState === (complete ? "ready" : "generating")
        ? summary.stateChangedAt
        : timestamp,
    acceptedQuestionSummaries: [
      ...summary.acceptedQuestionSummaries,
      acceptedQuestionSummary(input.chunk.question),
    ],
    qualityFlags: qualityFlags.length
      ? [
          ...summary.qualityFlags,
          { ordinal: input.chunk.startIndex, codes: qualityFlags },
        ]
      : summary.qualityFlags,
    aiCalls:
      summary.aiCalls +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.aiCalls),
    retryCount:
      summary.retryCount +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.retryCount),
    inputTokens:
      summary.inputTokens +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.inputTokens),
    outputTokens:
      summary.outputTokens +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.outputTokens),
    reasoningTokens:
      summary.reasoningTokens +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.reasoningTokens),
    elapsedMs:
      summary.elapsedMs +
      (summary.telemetryAvailable ? 0 : input.chunk.metrics.elapsedMs),
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
        qualityFlags,
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
  await renewGenerationClaim(c.env.DB, bank.id, importKey, timestamp);
  return c.json(
    ExtensionQuizProgressiveImportResponseSchema.parse(
      await progressiveImportState(c.env.DB, bank.id),
    ),
  );
});

quizImportsRouter.put("/:quizId/calls/:sessionId/:callIndex", async (c) => {
  const user = c.get("user");
  const importKey = requireIdempotencyKey(c);
  await enforceRateLimit(c.env.DB, {
    namespace: "extension-progressive-call-event",
    identifier: user.id,
    maximum: 90,
    windowSeconds: 60,
  });
  const input = await parseJson(
    c,
    ExtensionQuizGenerationCallEventRequestSchema,
  );
  if (
    c.req.param("sessionId") !== input.generationSessionId ||
    c.req.param("callIndex") !== String(input.callIndex)
  ) {
    throw new ApiError(
      409,
      "generation_call_identity_mismatch",
      "The call event identity does not match its request path.",
    );
  }
  const bank = await progressiveBank(
    c.env.DB,
    c.req.param("quizId"),
    user.id,
    importKey,
  );
  const snapshot = await readProgressiveGenerationSnapshot(c.env.DB, bank.id);
  if (!snapshot.summary || !snapshot.availability) {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This quiz does not support current progressive question delivery.",
    );
  }
  if (
    input.startIndex >= snapshot.summary.plannedCount ||
    input.startIndex + input.requestedCount > snapshot.summary.plannedCount
  ) {
    throw new ApiError(
      422,
      "generation_call_range_invalid",
      "The call event is outside this quiz's planned question range.",
    );
  }

  const replay = await storedCallEvent(
    c.env.DB,
    bank.id,
    input.generationSessionId,
    input.callIndex,
  );
  if (replay) {
    if (!callEventsMatch(replay, input)) {
      throw new ApiError(
        409,
        "generation_call_conflict",
        "That generation call was already recorded with different data.",
      );
    }
    return c.json(
      ExtensionQuizGenerationCallEventResponseSchema.parse({
        quizId: bank.id,
        recorded: true,
      }),
    );
  }

  if (input.classification === "automatic_retry") {
    const existingRetry = await c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM quiz_generation_call_events WHERE quiz_id = ? AND generation_session_id = ? AND classification = 'automatic_retry'",
    )
      .bind(bank.id, input.generationSessionId)
      .first<{ count: number }>();
    if (Number(existingRetry?.count ?? 0) >= 1) {
      throw new ApiError(
        409,
        "automatic_retry_budget_exceeded",
        "Only one transient automatic retry is permitted per generation session.",
      );
    }
  }

  await assertGenerationCallSequence(
    c.env.DB,
    bank.id,
    importKey,
    snapshot.summary.acceptedCount,
    input,
  );

  const timestamp = now();
  const result = await c.env.DB.prepare(
    `INSERT INTO quiz_generation_call_events
     (quiz_id, generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bank.id,
      input.generationSessionId,
      input.callIndex,
      input.startIndex,
      input.requestedCount,
      input.acceptedCount,
      input.classification,
      input.outcome,
      input.retryDelayMs,
      input.elapsedMs,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.reasoningTokens ?? null,
      input.usageComplete ? 1 : 0,
      timestamp,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(
      409,
      "generation_call_conflict",
      "The generation call event could not be recorded.",
    );
  }
  await renewGenerationClaim(c.env.DB, bank.id, importKey, timestamp);
  return c.json(
    ExtensionQuizGenerationCallEventResponseSchema.parse({
      quizId: bank.id,
      recorded: true,
    }),
    201,
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
    const timestamp = now();
    const nextSummary = ProgressiveQuizSummarySchema.parse({
      ...summary,
      generationState: input.state,
      reasonCode: input.reasonCode,
      stateChangedAt:
        summary.generationState === input.state
          ? summary.stateChangedAt
          : timestamp,
    });
    const updateSummary = c.env.DB.prepare(
      "UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'generating' AND quality_summary_json = ?",
    ).bind(
      JSON.stringify(nextSummary),
      bank.id,
      user.id,
      importKey,
      LOCAL_QUIZ_PIPELINE_VERSION,
      snapshot.qualitySummaryJson,
    );
    if (input.state === "retry_required") {
      const results = await c.env.DB.batch([
        updateSummary,
        c.env.DB.prepare(
          "UPDATE quiz_generation_claims SET lease_expires_at = ?, updated_at = ? WHERE quiz_id = ? AND claim_key = ?",
        ).bind(timestamp, timestamp, bank.id, importKey),
      ]);
      if (results[0]?.meta.changes !== 1) {
        throw new ApiError(
          409,
          "quiz_generation_state_conflict",
          "Generation state changed before this update could be stored.",
        );
      }
    } else {
      const result = await updateSummary.run();
      if (result.meta.changes !== 1) {
        throw new ApiError(
          409,
          "quiz_generation_state_conflict",
          "Generation state changed before this update could be stored.",
        );
      }
    }
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
  const qualityFlags = questionQualityFlags(question, []);
  const summary = ProgressiveQuizSummarySchema.parse({
    source: "extension-local-json-stream",
    importVersion:
      chunk.importVersion ??
      (chunk.promptVersion === "quiz-local-json-stream-v5.2"
        ? LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
        : "extension-progressive-import-v3"),
    resultProtocolVersion: chunk.protocolVersion,
    pipelineVersion: chunk.pipelineVersion,
    model: chunk.model,
    reasoningEffort: chunk.reasoningEffort,
    promptVersion: chunk.promptVersion,
    validatorVersion: chunk.validatorVersion,
    generationProfile: chunk.generationProfile ?? "legacy_reasoning_v5_1",
    generationId: chunk.generationId,
    questionPlanSeed: chunk.questionPlan?.seed,
    generationState: "generating",
    requestedQuestionTypes: input.input.questionTypes,
    plannedQuestionTypes: chunk.questionPlan?.types,
    generatedQuestionTypes: [question.type],
    plannedCount: chunk.totalQuestions,
    acceptedCount: 1,
    lastProgressAt: timestamp,
    lastQuestionAt: timestamp,
    stateChangedAt: timestamp,
    telemetryAvailable: chunk.promptVersion === "quiz-local-json-stream-v5.2",
    qualityFlags: qualityFlags.length
      ? [{ ordinal: 0, codes: qualityFlags }]
      : [],
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
      undefined,
      qualityFlags,
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

type StoredCallEvent = {
  generation_session_id: string;
  call_index: number;
  start_ordinal: number;
  requested_count: number;
  accepted_count: number;
  classification: LocalGenerationCallEvent["classification"];
  outcome_code: LocalGenerationCallEvent["outcome"];
  retry_delay_ms: number;
  elapsed_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  usage_complete: number;
};

async function storedCallEvent(
  db: D1Database,
  quizId: string,
  generationSessionId: string,
  callIndex: number,
): Promise<StoredCallEvent | null> {
  return db
    .prepare(
      `SELECT generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete
       FROM quiz_generation_call_events
       WHERE quiz_id = ? AND generation_session_id = ? AND call_index = ?`,
    )
    .bind(quizId, generationSessionId, callIndex)
    .first<StoredCallEvent>();
}

function callEventsMatch(
  stored: StoredCallEvent,
  event: LocalGenerationCallEvent,
): boolean {
  return (
    stored.generation_session_id === event.generationSessionId &&
    Number(stored.call_index) === event.callIndex &&
    Number(stored.start_ordinal) === event.startIndex &&
    Number(stored.requested_count) === event.requestedCount &&
    Number(stored.accepted_count) === event.acceptedCount &&
    stored.classification === event.classification &&
    stored.outcome_code === event.outcome &&
    Number(stored.retry_delay_ms) === event.retryDelayMs &&
    Number(stored.elapsed_ms) === event.elapsedMs &&
    nullableNumber(stored.input_tokens) === (event.inputTokens ?? null) &&
    nullableNumber(stored.output_tokens) === (event.outputTokens ?? null) &&
    nullableNumber(stored.reasoning_tokens) ===
      (event.reasoningTokens ?? null) &&
    Boolean(stored.usage_complete) === event.usageComplete
  );
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

async function assertGenerationCallSequence(
  db: D1Database,
  quizId: string,
  importKey: string,
  acceptedQuestionCount: number,
  event: LocalGenerationCallEvent,
): Promise<void> {
  const eventFrontier = event.startIndex + event.acceptedCount;
  const bufferedFailedFirstCall =
    event.callIndex === 0 &&
    event.startIndex === 0 &&
    event.acceptedCount === 0 &&
    acceptedQuestionCount === 1 &&
    ["transient_http", "network_interrupted", "timeout"].includes(
      event.outcome,
    ) &&
    event.retryDelayMs > 0;
  if (acceptedQuestionCount !== eventFrontier && !bufferedFailedFirstCall) {
    throw new ApiError(
      409,
      "generation_call_progress_conflict",
      "The call event does not match the stored question frontier.",
    );
  }

  const claim = await db
    .prepare(
      "SELECT generation_session_id, claim_key, lease_expires_at FROM quiz_generation_claims WHERE quiz_id = ?",
    )
    .bind(quizId)
    .first<{
      generation_session_id: string;
      claim_key: string;
      lease_expires_at: number;
    }>();
  const claimedSession =
    claim?.generation_session_id === event.generationSessionId &&
    claim.claim_key === importKey;
  if (
    (event.classification === "manual_continuation" && !claimedSession) ||
    (claimedSession && event.classification === "primary")
  ) {
    throw new ApiError(
      409,
      "generation_call_classification_conflict",
      "The call classification does not match its continuation claim.",
    );
  }

  if (event.callIndex === 0) {
    if (
      event.classification === "automatic_retry" ||
      (event.classification === "primary" && event.startIndex !== 0)
    ) {
      throw new ApiError(
        409,
        "generation_call_sequence_conflict",
        "The generation session did not begin with a valid primary call.",
      );
    }
    return;
  }

  const previous = await storedCallEvent(
    db,
    quizId,
    event.generationSessionId,
    event.callIndex - 1,
  );
  if (!previous) {
    throw new ApiError(
      409,
      "generation_call_sequence_conflict",
      "Generation call events must be recorded consecutively.",
    );
  }
  const expectedStart =
    Number(previous.start_ordinal) + Number(previous.accepted_count);
  if (event.startIndex !== expectedStart) {
    throw new ApiError(
      409,
      "generation_call_sequence_conflict",
      "The next call must begin at the first missing question.",
    );
  }

  if (event.classification === "automatic_retry") {
    const retryableOutcomes = new Set([
      "transient_http",
      "network_interrupted",
      "timeout",
    ]);
    if (
      !retryableOutcomes.has(previous.outcome_code) ||
      Number(previous.retry_delay_ms) <= 0 ||
      event.requestedCount !== 1
    ) {
      throw new ApiError(
        409,
        "generation_call_retry_conflict",
        "An automatic retry requires one confirmed transient predecessor.",
      );
    }
    return;
  }

  if (previous.outcome_code !== "complete") {
    throw new ApiError(
      409,
      "generation_call_sequence_conflict",
      "A non-retry call cannot follow a failed generation call.",
    );
  }
  const expectedClassification = claimedSession
    ? "manual_continuation"
    : "primary";
  if (event.classification !== expectedClassification) {
    throw new ApiError(
      409,
      "generation_call_classification_conflict",
      "The call classification changed within one generation session.",
    );
  }
}

async function renewGenerationClaim(
  db: D1Database,
  quizId: string,
  importKey: string,
  timestamp: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE quiz_generation_claims SET lease_expires_at = ?, updated_at = ? WHERE quiz_id = ? AND claim_key = ?",
    )
    .bind(timestamp + GENERATION_CLAIM_LEASE_MS, timestamp, quizId, importKey)
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
        undefined,
        questionQualityFlags(
          question,
          questions
            .slice(0, ordinal)
            .map((accepted) => acceptedQuestionSummary(accepted)),
        ),
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
  _questionCount: number,
  metadata: Pick<
    LocalConceptQuizQuestionChunk,
    "pipelineVersion" | "model" | "promptVersion" | "validatorVersion"
  >,
  questionId = createId(),
  qualityFlags: QuestionQualityFlag[] = [],
): D1PreparedStatement {
  const stored = storedQuestionFields(question);
  const difficulty = structuralDifficulty(question);
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
      difficulty,
      JSON.stringify({
        source: "extension-local-tool",
        blueprintSlot: question.id,
        concept: question.concept,
        questionType: question.type,
        pipelineVersion: metadata.pipelineVersion,
        model: metadata.model,
        promptVersion: metadata.promptVersion,
        validatorVersion: metadata.validatorVersion,
        structuralDifficulty: difficulty,
        qualityFlags,
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

export function structuralDifficulty(
  question: LocalConceptQuizQuestion,
): number {
  const prompt = question.question.normalize("NFKC").toLocaleLowerCase();
  let score = 1;
  if (/\b(how|why|explain|compare|contrast|derive|apply)\b/.test(prompt)) {
    score += 1;
  }
  if (/\b(analy[sz]e|evaluate|justify|prove|predict|what if)\b/.test(prompt)) {
    score += 1;
  }
  const expression = `${question.question} ${
    typeof question.answer === "string" ? question.answer : ""
  }`;
  const operations = expression.match(
    /[+\-*/^=]|[×÷]|\b(?:sin|cos|tan|log|lim)\b/gi,
  )?.length;
  if ((operations ?? 0) >= 2) score += 1;
  if ((operations ?? 0) >= 5 || /[()[\]{}].*[()[\]{}]/.test(expression)) {
    score += 1;
  }
  if (question.type === "short_answer" && question.rubricIdeas.length >= 3) {
    score += 1;
  }
  if (question.type === "multiple_choice") {
    const similarities: number[] = [];
    for (let left = 0; left < question.choices.length; left += 1) {
      for (let right = left + 1; right < question.choices.length; right += 1) {
        similarities.push(
          tokenSimilarity(question.choices[left]!, question.choices[right]!),
        );
      }
    }
    if (Math.max(...similarities, 0) >= 0.65) score += 1;
  }
  return Math.max(1, Math.min(5, score));
}

type QuestionQualityFlag =
  | "concept_overlap"
  | "low_structural_difficulty"
  | "high_structural_difficulty"
  | "similar_distractors";

export function questionQualityFlags(
  question: LocalConceptQuizQuestion,
  accepted: Array<{ concept: string }>,
): QuestionQualityFlag[] {
  const flags: QuestionQualityFlag[] = [];
  const difficulty = structuralDifficulty(question);
  if (difficulty <= 1) flags.push("low_structural_difficulty");
  if (difficulty >= 5) flags.push("high_structural_difficulty");
  if (
    accepted.some(
      (candidate) =>
        tokenSimilarity(candidate.concept, question.concept) >= 0.65,
    )
  ) {
    flags.push("concept_overlap");
  }
  if (question.type === "multiple_choice") {
    let maximumSimilarity = 0;
    for (let left = 0; left < question.choices.length; left += 1) {
      for (let right = left + 1; right < question.choices.length; right += 1) {
        maximumSimilarity = Math.max(
          maximumSimilarity,
          tokenSimilarity(question.choices[left]!, question.choices[right]!),
        );
      }
    }
    if (maximumSimilarity >= 0.65) flags.push("similar_distractors");
  }
  return flags;
}

function tokenSimilarity(left: string, right: string): number {
  const tokenize = (value: string) =>
    new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

export function promptSimilarity(left: string, right: string): number {
  const canonical = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const leftValue = canonical(left);
  const rightValue = canonical(right);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  const shingles = (value: string) => {
    const compact = value.replace(/\s+/g, " ");
    if (compact.length <= 3) return new Set([compact]);
    return new Set(
      Array.from({ length: compact.length - 2 }, (_, index) =>
        compact.slice(index, index + 3),
      ),
    );
  };
  const leftShingles = shingles(leftValue);
  const rightShingles = shingles(rightValue);
  const union = new Set([...leftShingles, ...rightShingles]);
  let intersection = 0;
  for (const shingle of leftShingles) {
    if (rightShingles.has(shingle)) intersection += 1;
  }
  return union.size === 0 ? 0 : intersection / union.size;
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
