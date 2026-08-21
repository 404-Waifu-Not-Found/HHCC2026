import {
  ExtensionQuizChunkAppendRequestSchema,
  ExtensionQuizGenerationCallEventRequestSchema,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizGenerationProgressRequestSchema,
  ExtensionQuizImportRequestSchema,
  ExtensionQuizImportResponseSchema,
  ExtensionQuizProgressiveImportRequestSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
  LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  type ExtensionQuizImportRequest,
  type ExtensionQuizProgressiveImportRequest,
  type LocalGenerationCallEvent,
  type LocalGenerationCallEventV3,
  type LocalGenerationCallEventV4,
  type LocalGenerationCallEventV5,
  type LocalGenerationCallEventV6,
  type LegacyAutomaticRecoveryCallEvent,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizQuestionChunk,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { generationProfileAllowsNewBank } from "../lib/generation-rollout";
import { createId, now } from "../lib/ids";
import { requireIdempotencyKey } from "../lib/idempotency";
import { enforceRateLimit } from "../lib/rate-limit";
import {
  ProgressiveQuizSummarySchema,
  acceptedQuestionSummary,
  assertProgressiveChunkMetadata,
  sharedEngineClientTransitionAllowed,
  readProgressiveGenerationSnapshot,
  retryKindMatchesGenerationOutcome,
  tryProgressiveQuizSummary,
  type ProgressiveQuizSummary,
} from "../lib/progressive-quiz";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const QUIZ_IMPORT_VERSION = "extension-quiz-import-v3" as const;
// Match the attempt claim lease: background local generation must survive a
// learner pause and a delayed browser heartbeat without being stolen by
// automatic recovery while a DeepSeek call is still active.
const AUTOMATIC_GENERATION_CLAIM_LEASE_MS = 5 * 60 * 1_000;
const LEGACY_GENERATION_CLAIM_LEASE_MS = 15 * 60 * 1_000;
// Keep the authoritative Worker budget aligned with the local engine: one
// primary call plus two automatic repairs for a failed ordinal.
const MAX_V5_3_AUTOMATIC_RETRIES = 3;
const MAX_V5_4_AUTOMATIC_RETRIES = 3;
const MAX_V5_6_AUTOMATIC_RETRIES = 3;
const MAX_V5_8_AUTOMATIC_RETRIES = 3;
const MAX_V5_9_AUTOMATIC_RETRIES = 3;
const MAX_V5_10_AUTOMATIC_RETRIES = 3;
const MAX_V5_11_AUTOMATIC_RETRIES = 3;
const MAX_V5_12_AUTOMATIC_RETRIES = 3;

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return (left[index] ?? 0) > (right[index] ?? 0);
    }
  }
  return true;
}

function assertNewGenerationClient(chunk: LocalConceptQuizQuestionChunk): void {
  if (!chunk.client) return;
  const native = chunk.client.kind !== "chrome_extension";
  const minimum = native ? "0.2.0" : "0.8.24";
  const clientName =
    chunk.client.kind === "android_app"
      ? "Android"
      : chunk.client.kind === "ios_app"
        ? "iOS"
        : "Local AI";
  if (!versionAtLeast(chunk.client.version, minimum)) {
    throw new ApiError(
      403,
      "local_generation_client_outdated",
      `ClipQuest ${clientName} ${minimum} or newer is required.`,
    );
  }
}

export function assertCurrentRetryQuestion(
  chunk: LocalConceptQuizQuestionChunk,
): void {
  if (chunk.promptVersion !== "quiz-local-json-stream-v5.12") {
    return;
  }
  const normalizePrompt = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const original = normalizePrompt(chunk.question.question);
  const retry = chunk.question.retryQuestion
    ? normalizePrompt(chunk.question.retryQuestion)
    : "";
  if (!retry || retry === original) {
    throw new ApiError(
      422,
      "quiz_retry_question_invalid",
      "The AI-generated adaptive retry prompt must be present and distinct.",
    );
  }
}

function assertGenerationEventClient(
  summary: ProgressiveQuizSummary,
  event: LocalGenerationCallEvent,
): void {
  const originalClientKind = summary.client?.kind ?? "chrome_extension";
  const clientMatches = summary.client
    ? JSON.stringify(summary.client) === JSON.stringify(event.client)
    : event.client === undefined || event.client.kind === "chrome_extension";
  if (
    !clientMatches &&
    !(
      event.client?.kind !== originalClientKind &&
      sharedEngineClientTransitionAllowed(summary, event.client)
    )
  ) {
    throw new ApiError(
      409,
      "quiz_generation_client_mismatch",
      "Generation telemetry must use the quiz's original client.",
    );
  }
}

type AutomaticGenerationCallEvent =
  | LegacyAutomaticRecoveryCallEvent
  | LocalGenerationCallEventV3
  | LocalGenerationCallEventV4
  | LocalGenerationCallEventV5
  | LocalGenerationCallEventV6;

function isAutomaticGenerationProfile(
  profile: ProgressiveQuizSummary["generationProfile"],
): boolean {
  return (
    profile === "stable_auto_recovery_v5_3" ||
    profile === "evidence_grounded_auto_v5_4" ||
    profile === "concept_first_auto_v5_8" ||
    profile === "prompt_first_auto_v5_9" ||
    profile === "prompt_first_auto_v5_10" ||
    profile === "prompt_first_auto_v5_11" ||
    profile === "prompt_first_auto_v5_12"
  );
}

function isPromptFirstProfile(
  profile: ProgressiveQuizSummary["generationProfile"] | undefined,
): boolean {
  return (
    profile === "prompt_first_auto_v5_9" ||
    profile === "prompt_first_auto_v5_10" ||
    profile === "prompt_first_auto_v5_11" ||
    profile === "prompt_first_auto_v5_12"
  );
}

function expectedAutomaticProtocol(
  profile: ProgressiveQuizSummary["generationProfile"],
): number | null {
  if (profile === "stable_auto_recovery_v5_3") {
    return AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION;
  }
  if (profile === "evidence_grounded_auto_v5_4") {
    return 8;
  }
  if (profile === "concept_first_auto_v5_8") {
    return CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION;
  }
  if (isPromptFirstProfile(profile)) {
    return LOCAL_QUIZ_RESULT_PROTOCOL_VERSION;
  }
  return null;
}

export const quizImportsRouter = new Hono<ApiBindings>();

export function currentGroundedNewBankMetadataMatches(
  chunk: Pick<
    LocalConceptQuizQuestionChunk,
    | "generationProfile"
    | "model"
    | "pipelineVersion"
    | "promptVersion"
    | "validatorVersion"
    | "protocolVersion"
    | "importVersion"
  >,
): boolean {
  if (chunk.generationProfile === "prompt_first_auto_v5_12") {
    return (
      chunk.model === LOCAL_QUIZ_MODEL &&
      chunk.pipelineVersion === LOCAL_QUIZ_PIPELINE_VERSION &&
      chunk.promptVersion === LOCAL_QUIZ_PROMPT_VERSION &&
      chunk.validatorVersion === LOCAL_QUIZ_VALIDATOR_VERSION &&
      chunk.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
      chunk.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
    );
  }
  if (chunk.generationProfile === "prompt_first_auto_v5_11") {
    return (
      chunk.model === LOCAL_QUIZ_MODEL &&
      chunk.pipelineVersion === LOCAL_QUIZ_PIPELINE_VERSION &&
      chunk.promptVersion === "quiz-local-json-stream-v5.11" &&
      chunk.validatorVersion === "validator-minimal-gradeability-v5.2" &&
      chunk.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
      chunk.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
    );
  }
  if (chunk.generationProfile === "prompt_first_auto_v5_10") {
    return (
      chunk.model === LOCAL_QUIZ_MODEL &&
      chunk.pipelineVersion === LOCAL_QUIZ_PIPELINE_VERSION &&
      chunk.promptVersion === "quiz-local-json-stream-v5.10" &&
      chunk.validatorVersion === "validator-minimal-gradeability-v5.1" &&
      chunk.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
      chunk.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
    );
  }
  if (chunk.generationProfile === "prompt_first_auto_v5_9") {
    return (
      chunk.model === LOCAL_QUIZ_MODEL &&
      chunk.pipelineVersion === LOCAL_QUIZ_PIPELINE_VERSION &&
      chunk.promptVersion === "quiz-local-json-stream-v5.9" &&
      chunk.validatorVersion === "validator-minimal-structural-v5.0" &&
      chunk.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
      chunk.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
    );
  }
  if (chunk.generationProfile !== "concept_first_auto_v5_8") {
    return true;
  }
  return (
    chunk.model === LOCAL_QUIZ_MODEL &&
    chunk.pipelineVersion === LOCAL_QUIZ_PIPELINE_VERSION &&
    chunk.promptVersion === "quiz-local-json-stream-v5.8" &&
    chunk.validatorVersion === "validator-local-progressive-v4.12" &&
    chunk.protocolVersion ===
      CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
    chunk.importVersion === "extension-progressive-import-v7"
  );
}

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
  assertNewGenerationClient(input.chunk);
  if (
    !generationProfileAllowsNewBank(
      c.env,
      user.id,
      input.chunk.generationProfile ?? "legacy_reasoning_v5_1",
    )
  ) {
    throw new ApiError(
      403,
      "quiz_generation_profile_disabled",
      "The stable generation profile is not enabled for this account yet.",
    );
  }
  if (!currentGroundedNewBankMetadataMatches(input.chunk)) {
    throw new ApiError(
      403,
      "quiz_generation_profile_disabled",
      "Install the current ClipQuest Local AI release before creating a new grounded quiz.",
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
  const clientTransitionAllowed = sharedEngineClientTransitionAllowed(
    summary,
    input.chunk.client,
  );
  assertProgressiveChunkMetadata(summary, input.chunk, {
    allowClientTransition: clientTransitionAllowed,
  });
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
  assertCurrentRetryQuestion(input.chunk);
  if (
    !isPromptFirstProfile(summary.generationProfile) &&
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
  if (
    summary.generationProfile === "evidence_grounded_auto_v5_4" ||
    summary.generationProfile === "concept_first_auto_v5_8"
  ) {
    assertGroundedQuestionIdentity(
      input.chunk.question,
      summary.acceptedQuestionSummaries,
    );
  }

  const nextCount = input.chunk.startIndex + 1;
  const qualityFlags = isPromptFirstProfile(summary.generationProfile)
    ? []
    : questionQualityFlags(
        input.chunk.question,
        summary.acceptedQuestionSummaries,
      );
  const complete = nextCount === summary.plannedCount;
  const questionId = createId();
  const timestamp = now();
  const liveClaim = isAutomaticGenerationProfile(summary.generationProfile)
    ? {
        key: importKey,
        recoverySessionId: snapshot.claimRecoverySessionId,
        timestamp,
      }
    : undefined;
  const nextSummary = ProgressiveQuizSummarySchema.parse({
    ...summary,
    source: clientTransitionAllowed
      ? input.chunk.client?.kind !== "chrome_extension"
        ? "client-local-json-stream"
        : "extension-local-json-stream"
      : summary.source,
    client: clientTransitionAllowed ? input.chunk.client : summary.client,
    generationState: complete ? "ready" : "generating",
    reasonCode: undefined,
    retryOrdinal: undefined,
    ordinalAttempt: undefined,
    retryKind: undefined,
    retryDelayMs: undefined,
    nextRecoveryAt: undefined,
    recoveryPhase: complete ? "complete" : undefined,
    activeCallIndex: undefined,
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
        liveClaim,
      ),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO attempt_items (attempt_id, ordinal, question_id)
         SELECT attempts.id, ?, ?
         FROM attempts
         JOIN questions ON questions.id = ? AND questions.quiz_id = attempts.quiz_id AND questions.ordinal = ?
         WHERE attempts.quiz_id = ?`,
      ).bind(
        input.chunk.startIndex,
        questionId,
        questionId,
        input.chunk.startIndex,
        bank.id,
      ),
      c.env.DB.prepare(
        `UPDATE quiz_banks SET quality_status = ?, quality_summary_json = ?, concepts_json = ?
         WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'generating'
         ${liveClaim ? "AND EXISTS (SELECT 1 FROM quiz_generation_claims claim WHERE claim.quiz_id = quiz_banks.id AND claim.claim_key = ? AND claim.lease_expires_at > ? AND (? IS NULL OR claim.recovery_session_id = ?))" : ""}`,
      ).bind(
        complete ? "passed" : "generating",
        JSON.stringify(nextSummary),
        conceptsJson,
        bank.id,
        user.id,
        importKey,
        LOCAL_QUIZ_PIPELINE_VERSION,
        ...(liveClaim
          ? [
              liveClaim.key,
              liveClaim.timestamp,
              liveClaim.recoverySessionId,
              liveClaim.recoverySessionId,
            ]
          : []),
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
  await renewGenerationClaim(
    c.env.DB,
    bank.id,
    importKey,
    timestamp,
    summary.generationProfile,
    snapshot.claimRecoverySessionId ?? undefined,
  );
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
  assertGenerationEventClient(snapshot.summary, input);
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
  const automaticEvent = isAutomaticCallEvent(input);
  const expectedProtocol = expectedAutomaticProtocol(
    snapshot.summary.generationProfile,
  );
  const legacyAutomaticRecovery = isLegacyAutomaticRecoveryCallEvent(input);
  const protocolMatches =
    snapshot.summary.generationProfile === "legacy_reasoning_v5_1"
      ? !automaticEvent || legacyAutomaticRecovery
      : expectedProtocol === null
        ? !automaticEvent
        : automaticEvent && input.protocolVersion === expectedProtocol;
  if (!protocolMatches) {
    throw new ApiError(
      409,
      "generation_call_protocol_mismatch",
      "The call event protocol must match the quiz generation profile.",
    );
  }

  const replay = await storedCallEvent(
    c.env.DB,
    bank.id,
    input.generationSessionId,
    input.callIndex,
  );
  if (replay) {
    if (
      isLifecycleCallEvent(input) &&
      (replay.lifecycle_state ?? "completed") === "started" &&
      input.lifecycleState !== "started"
    ) {
      if (!lifecycleIdentityMatches(replay, input)) {
        throw new ApiError(
          409,
          "generation_call_conflict",
          "That generation call lifecycle has different immutable metadata.",
        );
      }
      const completedAt = now();
      const finalized = await c.env.DB.prepare(
        `UPDATE quiz_generation_call_events
         SET accepted_count = ?, outcome_code = ?, retry_delay_ms = ?, elapsed_ms = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, usage_complete = ?, lifecycle_state = ?, completed_at = ?, last_stream_activity_at = ?
         WHERE quiz_id = ? AND generation_session_id = ? AND call_index = ? AND lifecycle_state = 'started'`,
      )
        .bind(
          input.acceptedCount,
          input.outcome,
          input.retryDelayMs,
          input.elapsedMs,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.reasoningTokens ?? null,
          input.usageComplete ? 1 : 0,
          input.lifecycleState,
          completedAt,
          input.lastStreamActivityElapsedMs === undefined
            ? null
            : Number(replay.dispatched_at ?? completedAt) +
                input.lastStreamActivityElapsedMs,
          bank.id,
          input.generationSessionId,
          input.callIndex,
        )
        .run();
      if (finalized.meta.changes !== 1) {
        throw new ApiError(
          409,
          "generation_call_conflict",
          "That generation call lifecycle changed before finalization.",
        );
      }
      await renewGenerationClaim(
        c.env.DB,
        bank.id,
        importKey,
        completedAt,
        snapshot.summary.generationProfile,
        input.recoverySessionId,
      );
      await materializeGenerationTelemetry(
        c.env.DB,
        bank.id,
        user.id,
        importKey,
        input,
      );
      return c.json(
        ExtensionQuizGenerationCallEventResponseSchema.parse({
          quizId: bank.id,
          recorded: true,
        }),
      );
    }
    if (!callEventsMatch(replay, input)) {
      throw new ApiError(
        409,
        "generation_call_conflict",
        "That generation call was already recorded with different data.",
      );
    }
    await materializeGenerationTelemetry(
      c.env.DB,
      bank.id,
      user.id,
      importKey,
      input,
    );
    return c.json(
      ExtensionQuizGenerationCallEventResponseSchema.parse({
        quizId: bank.id,
        recorded: true,
      }),
    );
  }

  if (isLifecycleCallEvent(input) && input.lifecycleState !== "started") {
    throw new ApiError(
      409,
      "generation_call_lifecycle_missing",
      "A terminal call event requires its recorded dispatch lifecycle.",
    );
  }

  if (input.classification === "manual_continuation") {
    throw new ApiError(
      422,
      "manual_generation_continuation_removed",
      "New continuation calls must be recorded as automatic recovery.",
    );
  }

  if (input.classification === "automatic_retry") {
    const existingRetry = await c.env.DB.prepare(
      legacyAutomaticRecovery
        ? "SELECT COUNT(*) AS count FROM quiz_generation_call_events WHERE quiz_id = ? AND classification IN ('automatic_retry', 'manual_continuation')"
        : "SELECT COUNT(*) AS count FROM quiz_generation_call_events WHERE quiz_id = ? AND generation_session_id = ? AND classification = 'automatic_retry'",
    )
      .bind(
        ...(legacyAutomaticRecovery
          ? [bank.id]
          : [bank.id, input.generationSessionId]),
      )
      .first<{ count: number }>();
    const retryLimit = automaticEvent
      ? legacyAutomaticRecovery
        ? MAX_V5_6_AUTOMATIC_RETRIES
        : snapshot.summary.promptVersion === "quiz-local-json-stream-v5.12"
          ? MAX_V5_12_AUTOMATIC_RETRIES
          : snapshot.summary.promptVersion === "quiz-local-json-stream-v5.11"
            ? MAX_V5_11_AUTOMATIC_RETRIES
            : snapshot.summary.promptVersion === "quiz-local-json-stream-v5.10"
              ? MAX_V5_10_AUTOMATIC_RETRIES
              : snapshot.summary.promptVersion === "quiz-local-json-stream-v5.9"
                ? MAX_V5_9_AUTOMATIC_RETRIES
                : snapshot.summary.promptVersion ===
                    "quiz-local-json-stream-v5.8"
                  ? MAX_V5_8_AUTOMATIC_RETRIES
                  : snapshot.summary.promptVersion ===
                        "quiz-local-json-stream-v5.7" ||
                      snapshot.summary.promptVersion ===
                        "quiz-local-json-stream-v5.6"
                    ? MAX_V5_6_AUTOMATIC_RETRIES
                    : snapshot.summary.generationProfile ===
                        "evidence_grounded_auto_v5_4"
                      ? MAX_V5_4_AUTOMATIC_RETRIES
                      : MAX_V5_3_AUTOMATIC_RETRIES
      : 1;
    if (Number(existingRetry?.count ?? 0) >= retryLimit) {
      throw new ApiError(
        409,
        "automatic_retry_budget_exceeded",
        automaticEvent
          ? "The automatic recovery call budget has been exhausted."
          : "Only one transient automatic retry is permitted per generation session.",
      );
    }
    if (automaticEvent) {
      const promptFirst = isPromptFirstProfile(
        snapshot.summary.generationProfile,
      );
      const grounded =
        legacyAutomaticRecovery ||
        snapshot.summary.generationProfile === "evidence_grounded_auto_v5_4" ||
        snapshot.summary.generationProfile === "concept_first_auto_v5_8";
      const contentRetry = new Set([
        "empty_content",
        "truncated_output",
        "content_repair",
        "duplicate_repair",
        "answer_repair",
      ]).has(input.retryKind!);
      const ordinalRetries = await c.env.DB.prepare(
        promptFirst
          ? `SELECT COUNT(*) AS count
             FROM quiz_generation_call_events
             WHERE quiz_id = ?
               AND generation_session_id = ?
               AND recovery_session_id = ?
               AND start_ordinal = ?
               AND classification = 'automatic_retry'
               AND retry_kind = ?`
          : grounded
            ? `SELECT COUNT(*) AS count
             FROM quiz_generation_call_events
             WHERE quiz_id = ?
               AND generation_session_id = ?
               AND recovery_session_id = ?
               AND start_ordinal = ?
               AND classification = 'automatic_retry'
               AND (
                 (? = 1 AND retry_kind IN ('empty_content', 'truncated_output', 'content_repair', 'duplicate_repair', 'answer_repair'))
                 OR
                 (? = 0 AND retry_kind IN ('transport', 'automatic_resume'))
               )`
            : "SELECT COUNT(*) AS count FROM quiz_generation_call_events WHERE quiz_id = ? AND generation_session_id = ? AND start_ordinal = ? AND classification = 'automatic_retry' AND retry_kind = ?",
      )
        .bind(
          ...(promptFirst
            ? [
                bank.id,
                input.generationSessionId,
                input.recoverySessionId,
                input.startIndex,
                input.retryKind,
              ]
            : grounded
              ? [
                  bank.id,
                  input.generationSessionId,
                  input.recoverySessionId,
                  input.startIndex,
                  contentRetry ? 1 : 0,
                  contentRetry ? 1 : 0,
                ]
              : [
                  bank.id,
                  input.generationSessionId,
                  input.startIndex,
                  input.retryKind,
                ]),
        )
        .first<{ count: number }>();
      // Keep the server-side event budget aligned with the local engine: a
      // primary request plus at most two repairs for one ordinal. This stops a
      // stalled browser from multiplying a single bad question into a long
      // retry loop.
      const perOrdinalLimit = contentRetry || promptFirst ? 2 : 3;
      if (Number(ordinalRetries?.count ?? 0) >= perOrdinalLimit) {
        throw new ApiError(
          409,
          "automatic_retry_ordinal_budget_exceeded",
          "The automatic retry budget for this question has been exhausted.",
        );
      }
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
     (quiz_id, generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, created_at, protocol_version, retry_kind, ordinal_attempt, recovery_session_id, purpose, lifecycle_state, dispatched_at, completed_at, last_stream_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bank.id,
      input.generationSessionId,
      input.callIndex,
      input.startIndex,
      input.requestedCount,
      input.acceptedCount,
      input.classification,
      isLifecycleCallEvent(input) && input.lifecycleState === "started"
        ? "call_started"
        : input.outcome,
      input.retryDelayMs,
      input.elapsedMs ?? 0,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.reasoningTokens ?? null,
      input.usageComplete ? 1 : 0,
      timestamp,
      automaticEvent ? input.protocolVersion : null,
      automaticEvent ? (input.retryKind ?? null) : null,
      automaticEvent ? input.ordinalAttempt : null,
      automaticEvent ? input.recoverySessionId : null,
      isGroundedCallEvent(input) ? input.purpose : null,
      isLifecycleCallEvent(input) ? input.lifecycleState : "completed",
      timestamp,
      isLifecycleCallEvent(input) && input.lifecycleState === "started"
        ? null
        : timestamp,
      isLifecycleCallEvent(input) &&
        input.lastStreamActivityElapsedMs !== undefined
        ? timestamp + input.lastStreamActivityElapsedMs
        : null,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(
      409,
      "generation_call_conflict",
      "The generation call event could not be recorded.",
    );
  }
  await renewGenerationClaim(
    c.env.DB,
    bank.id,
    importKey,
    timestamp,
    snapshot.summary.generationProfile,
    isAutomaticCallEvent(input) ? input.recoverySessionId : undefined,
  );
  await materializeGenerationTelemetry(
    c.env.DB,
    bank.id,
    user.id,
    importKey,
    input,
  );
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
  await enforceRateLimit(c.env.DB, {
    namespace: "extension-progressive-progress",
    identifier: user.id,
    maximum: 90,
    windowSeconds: 60,
  });
  const bank = await progressiveBank(
    c.env.DB,
    c.req.param("quizId"),
    user.id,
    importKey,
  );
  const input = await parseJson(
    c,
    ExtensionQuizGenerationProgressRequestSchema,
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
    if (
      isAutomaticGenerationProfile(summary.generationProfile) &&
      input.state === "retry_required"
    ) {
      throw new ApiError(
        422,
        "manual_generation_continuation_removed",
        "Automatic-generation banks cannot enter a manual continuation state.",
      );
    }
    if (
      isAutomaticGenerationProfile(summary.generationProfile) &&
      input.state === "retrying" &&
      (!input.retryOrdinal ||
        !input.ordinalAttempt ||
        !input.retryKind ||
        !input.recoverySessionId)
    ) {
      throw new ApiError(
        422,
        "automatic_retry_metadata_required",
        "Automatic retries require bounded ordinal recovery metadata.",
      );
    }
    const timestamp = now();
    const nextSummary = ProgressiveQuizSummarySchema.parse({
      ...summary,
      generationState: input.state,
      reasonCode: input.reasonCode,
      retryOrdinal: input.state === "retrying" ? input.retryOrdinal : undefined,
      ordinalAttempt:
        input.state === "retrying" ? input.ordinalAttempt : undefined,
      retryKind: input.state === "retrying" ? input.retryKind : undefined,
      retryDelayMs: input.state === "retrying" ? input.retryDelayMs : undefined,
      nextRecoveryAt:
        input.state === "cooldown" && input.nextRecoveryAt
          ? Date.parse(input.nextRecoveryAt)
          : undefined,
      recoveryPhase: input.recoveryPhase,
      activeCallIndex: input.activeCallIndex,
      recoverySessionId: isAutomaticGenerationProfile(summary.generationProfile)
        ? (input.recoverySessionId ?? summary.recoverySessionId)
        : summary.recoverySessionId,
      stateChangedAt:
        summary.generationState === input.state
          ? summary.stateChangedAt
          : timestamp,
    });
    const automatic = isAutomaticGenerationProfile(summary.generationProfile);
    const updateSummary = c.env.DB.prepare(
      `UPDATE quiz_banks SET quality_summary_json = ?
       WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_status = 'generating' AND quality_summary_json = ?
       ${automatic ? "AND EXISTS (SELECT 1 FROM quiz_generation_claims claim WHERE claim.quiz_id = quiz_banks.id AND claim.claim_key = ? AND claim.lease_expires_at > ? AND (? IS NULL OR claim.recovery_session_id = ?))" : ""}`,
    ).bind(
      JSON.stringify(nextSummary),
      bank.id,
      user.id,
      importKey,
      LOCAL_QUIZ_PIPELINE_VERSION,
      snapshot.qualitySummaryJson,
      ...(automatic
        ? [
            importKey,
            timestamp,
            input.recoverySessionId ?? snapshot.claimRecoverySessionId,
            input.recoverySessionId ?? snapshot.claimRecoverySessionId,
          ]
        : []),
    );
    if (
      input.state === "retry_required" ||
      input.state === "cooldown" ||
      input.state === "action_required" ||
      input.state === "generation_failed"
    ) {
      const results = await c.env.DB.batch([
        updateSummary,
        c.env.DB.prepare(
          `UPDATE quiz_generation_claims
           SET lease_expires_at = ?, updated_at = ?
           WHERE quiz_id = ? AND claim_key = ?
           ${automatic ? "AND lease_expires_at > ? AND (? IS NULL OR recovery_session_id = ?)" : ""}`,
        ).bind(
          timestamp,
          timestamp,
          bank.id,
          importKey,
          ...(automatic
            ? [
                timestamp,
                input.recoverySessionId ?? snapshot.claimRecoverySessionId,
                input.recoverySessionId ?? snapshot.claimRecoverySessionId,
              ]
            : []),
        ),
      ]);
      if (
        results[0]?.meta.changes !== 1 ||
        (automatic && results[1]?.meta.changes !== 1)
      ) {
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
  assertCurrentRetryQuestion(chunk);
  if (
    chunk.generationProfile === "evidence_grounded_auto_v5_4" ||
    chunk.generationProfile === "concept_first_auto_v5_8"
  ) {
    assertGroundedQuestionIdentity(question, []);
  }
  const qualityFlags = isPromptFirstProfile(chunk.generationProfile)
    ? []
    : questionQualityFlags(question, []);
  const summary = ProgressiveQuizSummarySchema.parse({
    source:
      chunk.client?.kind !== undefined &&
      chunk.client.kind !== "chrome_extension"
        ? "client-local-json-stream"
        : "extension-local-json-stream",
    client: chunk.client,
    importVersion:
      chunk.importVersion ??
      (chunk.promptVersion === "quiz-local-json-stream-v5.12" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.11" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.10" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.9"
        ? LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION
        : chunk.promptVersion === "quiz-local-json-stream-v5.8"
          ? "extension-progressive-import-v7"
          : chunk.promptVersion === "quiz-local-json-stream-v5.7" ||
              chunk.promptVersion === "quiz-local-json-stream-v5.6" ||
              chunk.promptVersion === "quiz-local-json-stream-v5.5" ||
              chunk.promptVersion === "quiz-local-json-stream-v5.4"
            ? "extension-progressive-import-v6"
            : chunk.promptVersion === "quiz-local-json-stream-v5.3"
              ? "extension-progressive-import-v5"
              : chunk.promptVersion === "quiz-local-json-stream-v5.2"
                ? "extension-progressive-import-v4"
                : "extension-progressive-import-v3"),
    resultProtocolVersion: chunk.protocolVersion,
    pipelineVersion: chunk.pipelineVersion,
    model: chunk.model,
    reasoningEffort: chunk.reasoningEffort,
    promptVersion: chunk.promptVersion,
    validatorVersion: chunk.validatorVersion,
    generationProfile: chunk.generationProfile ?? "legacy_reasoning_v5_1",
    generationId: chunk.generationId,
    generationSessionId: chunk.generationSessionId,
    recoverySessionId: chunk.recoverySessionId,
    questionPlanSeed: chunk.questionPlan?.seed,
    promptFingerprint: chunk.promptFingerprint,
    generationState: "generating",
    requestedQuestionTypes: input.input.questionTypes,
    plannedQuestionTypes: chunk.questionPlan?.types,
    generatedQuestionTypes: [question.type],
    plannedCount: chunk.totalQuestions,
    acceptedCount: 1,
    lastProgressAt: timestamp,
    lastQuestionAt: timestamp,
    stateChangedAt: timestamp,
    telemetryAvailable:
      chunk.promptVersion === "quiz-local-json-stream-v5.2" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.3" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.4" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.5" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.6" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.7" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.8" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.9" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.10" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.11" ||
      chunk.promptVersion === "quiz-local-json-stream-v5.12",
    sourceSelection: chunk.metrics.sourceSelection,
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
  if (
    isAutomaticGenerationProfile(summary.generationProfile) &&
    chunk.protocolVersion ===
      expectedAutomaticProtocol(summary.generationProfile) &&
    chunk.generationSessionId &&
    chunk.recoverySessionId
  ) {
    statements.push(
      input.db
        .prepare(
          `INSERT INTO quiz_generation_claims
             (quiz_id, generation_session_id, claim_key, lease_expires_at, updated_at, recovery_session_id, heartbeat_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.quizId,
          chunk.generationSessionId,
          input.importKey,
          timestamp + AUTOMATIC_GENERATION_CLAIM_LEASE_MS,
          timestamp,
          chunk.recoverySessionId,
          timestamp,
        ),
    );
  }
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
  let metadata: {
    concept?: unknown;
    claimKey?: unknown;
    conceptCluster?: unknown;
  };
  try {
    metadata = z
      .object({
        concept: z.string(),
        claimKey: z.string().optional(),
        conceptCluster: z.string().optional(),
      })
      .passthrough()
      .parse(JSON.parse(stored.generation_metadata_json));
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
    metadata.concept === question.concept &&
    metadata.claimKey === question.claimKey &&
    metadata.conceptCluster === question.conceptCluster
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
  outcome_code: string;
  retry_delay_ms: number;
  elapsed_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  usage_complete: number;
  protocol_version: number | null;
  retry_kind: string | null;
  ordinal_attempt: number | null;
  recovery_session_id: string | null;
  purpose: string | null;
  lifecycle_state: "started" | "completed" | "abandoned" | null;
  dispatched_at: number | null;
  completed_at: number | null;
  last_stream_activity_at: number | null;
};

function isAutomaticCallEvent(
  event: LocalGenerationCallEvent,
): event is AutomaticGenerationCallEvent {
  return (
    "protocolVersion" in event &&
    (event.protocolVersion === 5 ||
      event.protocolVersion === AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion === GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion ===
        CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION)
  );
}

function isLegacyAutomaticRecoveryCallEvent(
  event: LocalGenerationCallEvent,
): event is LegacyAutomaticRecoveryCallEvent {
  return (
    "protocolVersion" in event &&
    event.protocolVersion === 5 &&
    "purpose" in event &&
    event.purpose === "automatic_recovery"
  );
}

function isGroundedCallEvent(
  event: LocalGenerationCallEvent,
): event is
  | LocalGenerationCallEventV4
  | LocalGenerationCallEventV5
  | LocalGenerationCallEventV6 {
  return (
    "protocolVersion" in event &&
    (event.protocolVersion === GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion ===
        CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION)
  );
}

function isLifecycleCallEvent(
  event: LocalGenerationCallEvent,
): event is LocalGenerationCallEventV5 | LocalGenerationCallEventV6 {
  return (
    "protocolVersion" in event &&
    (event.protocolVersion ===
      CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION ||
      event.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION) &&
    "lifecycleState" in event
  );
}

async function storedCallEvent(
  db: D1Database,
  quizId: string,
  generationSessionId: string,
  callIndex: number,
): Promise<StoredCallEvent | null> {
  return db
    .prepare(
      `SELECT generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, protocol_version, retry_kind, ordinal_attempt, recovery_session_id, purpose, lifecycle_state, dispatched_at, completed_at, last_stream_activity_at
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
    stored.outcome_code ===
      (isLifecycleCallEvent(event) && event.lifecycleState === "started"
        ? "call_started"
        : event.outcome) &&
    Number(stored.retry_delay_ms) === event.retryDelayMs &&
    Number(stored.elapsed_ms) === (event.elapsedMs ?? 0) &&
    nullableNumber(stored.input_tokens) === (event.inputTokens ?? null) &&
    nullableNumber(stored.output_tokens) === (event.outputTokens ?? null) &&
    nullableNumber(stored.reasoning_tokens) ===
      (event.reasoningTokens ?? null) &&
    Boolean(stored.usage_complete) === event.usageComplete &&
    Number(stored.protocol_version ?? 0) ===
      (isAutomaticCallEvent(event) ? event.protocolVersion : 0) &&
    stored.retry_kind ===
      (isAutomaticCallEvent(event) ? (event.retryKind ?? null) : null) &&
    nullableNumber(stored.ordinal_attempt) ===
      (isAutomaticCallEvent(event) ? event.ordinalAttempt : null) &&
    stored.recovery_session_id ===
      (isAutomaticCallEvent(event) ? event.recoverySessionId : null) &&
    stored.purpose === (isGroundedCallEvent(event) ? event.purpose : null) &&
    (stored.lifecycle_state ?? "completed") ===
      (isLifecycleCallEvent(event) ? event.lifecycleState : "completed")
  );
}

function lifecycleIdentityMatches(
  stored: StoredCallEvent,
  event: LocalGenerationCallEventV5 | LocalGenerationCallEventV6,
): boolean {
  return (
    stored.generation_session_id === event.generationSessionId &&
    Number(stored.call_index) === event.callIndex &&
    Number(stored.start_ordinal) === event.startIndex &&
    Number(stored.requested_count) === event.requestedCount &&
    stored.classification === event.classification &&
    Number(stored.protocol_version) === event.protocolVersion &&
    stored.retry_kind === (event.retryKind ?? null) &&
    nullableNumber(stored.ordinal_attempt) === event.ordinalAttempt &&
    stored.recovery_session_id === event.recoverySessionId &&
    stored.purpose === event.purpose
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
  if (isLegacyAutomaticRecoveryCallEvent(event)) {
    await assertLegacyAutomaticRecoveryCallSequence(
      db,
      quizId,
      importKey,
      acceptedQuestionCount,
      event,
    );
    return;
  }
  if (isAutomaticCallEvent(event)) {
    await assertAutomaticGenerationCallSequence(
      db,
      quizId,
      importKey,
      acceptedQuestionCount,
      event,
    );
    return;
  }
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
      !previous.outcome_code ||
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

async function assertLegacyAutomaticRecoveryCallSequence(
  db: D1Database,
  quizId: string,
  importKey: string,
  acceptedQuestionCount: number,
  event: LegacyAutomaticRecoveryCallEvent,
): Promise<void> {
  const eventFrontier = event.startIndex + event.acceptedCount;
  if (
    event.startIndex !== acceptedQuestionCount &&
    eventFrontier !== acceptedQuestionCount
  ) {
    throw new ApiError(
      409,
      "generation_call_progress_conflict",
      "The recovery event does not match the stored question frontier.",
    );
  }

  const claim = await db
    .prepare(
      "SELECT generation_session_id, recovery_session_id, claim_key, lease_expires_at FROM quiz_generation_claims WHERE quiz_id = ?",
    )
    .bind(quizId)
    .first<{
      generation_session_id: string;
      recovery_session_id: string | null;
      claim_key: string;
      lease_expires_at: number;
    }>();
  if (
    claim?.generation_session_id !== event.generationSessionId ||
    claim.recovery_session_id !== event.recoverySessionId ||
    claim.claim_key !== importKey ||
    Number(claim.lease_expires_at) <= now()
  ) {
    throw new ApiError(
      409,
      "generation_recovery_lease_conflict",
      "This tab no longer owns the legacy automatic-recovery lease.",
    );
  }

  if (event.callIndex > 0) {
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
        "Legacy recovery call events must remain consecutive.",
      );
    }
  }

  const history = await db
    .prepare(
      `SELECT
         COUNT(*) AS attempts,
         COALESCE(MAX(COALESCE(ordinal_attempt, 1)), 1) AS latest_attempt,
         (
           SELECT covering.outcome_code
           FROM quiz_generation_call_events covering
           WHERE covering.quiz_id = ?
             AND covering.start_ordinal <= ?
             AND covering.start_ordinal + covering.requested_count > ?
             AND (
               covering.outcome_code <> 'complete'
               OR covering.accepted_count < covering.requested_count
             )
           ORDER BY covering.created_at DESC, covering.call_index DESC
           LIMIT 1
         ) AS latest_outcome
       FROM quiz_generation_call_events attempted
       WHERE attempted.quiz_id = ?
         AND attempted.start_ordinal <= ?
         AND attempted.start_ordinal + attempted.requested_count > ?
         AND (
           attempted.outcome_code <> 'complete'
           OR attempted.accepted_count < attempted.requested_count
         )`,
    )
    .bind(
      quizId,
      event.startIndex,
      event.startIndex,
      quizId,
      event.startIndex,
      event.startIndex,
    )
    .first<{
      attempts: number;
      latest_attempt: number;
      latest_outcome: string | null;
    }>();
  const previouslyAttempted = Number(history?.attempts ?? 0) > 0;
  const expectedClassification = previouslyAttempted
    ? "automatic_retry"
    : "primary";
  if (event.classification !== expectedClassification) {
    throw new ApiError(
      409,
      "generation_call_classification_conflict",
      previouslyAttempted
        ? "A previously failed ordinal must be recorded as an automatic retry."
        : "A never-attempted ordinal must be recorded as a primary call.",
    );
  }
  if (previouslyAttempted) {
    const expectedAttempt = Math.min(
      24,
      Math.max(2, Number(history?.latest_attempt ?? 1) + 1),
    );
    if (
      event.ordinalAttempt !== expectedAttempt ||
      !retryKindMatchesGenerationOutcome(
        event.retryKind,
        history?.latest_outcome ?? "local_state_conflict",
      )
    ) {
      throw new ApiError(
        409,
        "generation_call_retry_conflict",
        "The retry metadata does not match the failed ordinal history.",
      );
    }
  } else if (event.ordinalAttempt !== 1 || event.retryKind !== undefined) {
    throw new ApiError(
      409,
      "generation_call_sequence_conflict",
      "A new ordinal must begin with primary attempt one.",
    );
  }
}

async function assertAutomaticGenerationCallSequence(
  db: D1Database,
  quizId: string,
  importKey: string,
  acceptedQuestionCount: number,
  event: AutomaticGenerationCallEvent,
): Promise<void> {
  const eventFrontier = event.startIndex + event.acceptedCount;
  const bufferedFailedFirstCall =
    event.startIndex === 0 &&
    event.acceptedCount === 0 &&
    acceptedQuestionCount === 1;
  // Call telemetry is intentionally off the learner-facing upload path. The
  // authoritative question frontier may therefore be ahead by the time a
  // buffered lifecycle reaches D1, but it may never be behind an event that
  // claims to have accepted a question.
  if (acceptedQuestionCount < eventFrontier && !bufferedFailedFirstCall) {
    throw new ApiError(
      409,
      "generation_call_progress_conflict",
      "The call event does not match the stored question frontier.",
    );
  }

  const claim = await db
    .prepare(
      "SELECT generation_session_id, recovery_session_id, claim_key, lease_expires_at FROM quiz_generation_claims WHERE quiz_id = ?",
    )
    .bind(quizId)
    .first<{
      generation_session_id: string;
      recovery_session_id: string | null;
      claim_key: string;
      lease_expires_at: number;
    }>();
  if (
    claim?.generation_session_id !== event.generationSessionId ||
    claim.recovery_session_id !== event.recoverySessionId ||
    claim.claim_key !== importKey ||
    Number(claim.lease_expires_at) <= now()
  ) {
    throw new ApiError(
      409,
      "generation_recovery_lease_conflict",
      "This tab no longer owns the automatic recovery lease.",
    );
  }

  if (event.callIndex === 0) {
    if (
      event.classification !== "primary" ||
      event.startIndex !== 0 ||
      event.ordinalAttempt !== 1 ||
      event.retryKind !== undefined
    ) {
      throw new ApiError(
        409,
        "generation_call_sequence_conflict",
        "Automatic generation must begin with the primary q1 call.",
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
  if (
    !previous ||
    Number(previous.protocol_version) !== event.protocolVersion
  ) {
    throw new ApiError(
      409,
      "generation_call_sequence_conflict",
      "Automatic call events must be recorded consecutively.",
    );
  }

  if (event.classification === "primary") {
    if (
      previous.outcome_code !== "complete" ||
      event.startIndex !==
        Number(previous.start_ordinal) + Number(previous.accepted_count) ||
      event.ordinalAttempt !== 1 ||
      event.retryKind !== undefined
    ) {
      throw new ApiError(
        409,
        "generation_call_sequence_conflict",
        "A primary call must begin the next never-attempted question.",
      );
    }
    return;
  }

  const expectedAttempt = Number(previous.ordinal_attempt ?? 1) + 1;
  if (
    previous.outcome_code === "complete" ||
    event.startIndex !== Number(previous.start_ordinal) ||
    event.ordinalAttempt !== expectedAttempt ||
    !previous.outcome_code ||
    !retryKindMatchesGenerationOutcome(event.retryKind, previous.outcome_code)
  ) {
    throw new ApiError(
      409,
      "generation_call_retry_conflict",
      "An automatic retry must repair the immediately preceding failed singleton call.",
    );
  }
}

async function renewGenerationClaim(
  db: D1Database,
  quizId: string,
  importKey: string,
  timestamp: number,
  profile: ProgressiveQuizSummary["generationProfile"],
  recoverySessionId?: string,
): Promise<void> {
  const leaseMs =
    recoverySessionId || isAutomaticGenerationProfile(profile)
      ? AUTOMATIC_GENERATION_CLAIM_LEASE_MS
      : LEGACY_GENERATION_CLAIM_LEASE_MS;
  const result = await db
    .prepare(
      "UPDATE quiz_generation_claims SET lease_expires_at = ?, updated_at = ?, heartbeat_at = COALESCE(?, heartbeat_at) WHERE quiz_id = ? AND claim_key = ? AND lease_expires_at > ? AND (? IS NULL OR recovery_session_id = ?)",
    )
    .bind(
      timestamp + leaseMs,
      timestamp,
      recoverySessionId ? timestamp : null,
      quizId,
      importKey,
      timestamp,
      recoverySessionId ?? null,
      recoverySessionId ?? null,
    )
    .run();
  if (isAutomaticGenerationProfile(profile) && result.meta.changes !== 1) {
    throw new ApiError(
      409,
      "generation_claim_expired",
      "This generation lease expired before it could be renewed.",
    );
  }
}

async function materializeGenerationTelemetry(
  db: D1Database,
  quizId: string,
  userId: string,
  importKey: string,
  callEvent?: LocalGenerationCallEvent,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await readProgressiveGenerationSnapshot(db, quizId);
    const summary = snapshot.summary;
    if (!summary?.telemetryAvailable) return;

    const ready = summary.generationState === "ready";
    const nextSummary = ProgressiveQuizSummarySchema.parse({
      ...summary,
      aiCalls: snapshot.telemetry.callCount,
      retryCount: snapshot.telemetry.automaticRetries,
      inputTokens: snapshot.telemetry.inputTokens,
      outputTokens: snapshot.telemetry.outputTokens,
      reasoningTokens: snapshot.telemetry.reasoningTokens,
      elapsedMs: Math.max(1, snapshot.telemetry.elapsedMs),
      ...(callEvent && isLifecycleCallEvent(callEvent) && !ready
        ? callEvent.lifecycleState === "started"
          ? {
              recoveryPhase: "dispatched" as const,
              activeCallIndex: callEvent.callIndex,
            }
          : summary.activeCallIndex === callEvent.callIndex
            ? { recoveryPhase: undefined, activeCallIndex: undefined }
            : {}
        : {}),
    });
    const serialized = JSON.stringify(nextSummary);
    if (serialized === snapshot.qualitySummaryJson) return;

    const result = await db
      .prepare(
        "UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ? AND user_id = ? AND import_key = ? AND pipeline_version = ? AND quality_summary_json = ?",
      )
      .bind(
        serialized,
        quizId,
        userId,
        importKey,
        LOCAL_QUIZ_PIPELINE_VERSION,
        snapshot.qualitySummaryJson,
      )
      .run();
    if (result.meta.changes === 1) return;
  }

  throw new ApiError(
    409,
    "generation_telemetry_state_conflict",
    "Generation telemetry changed before it could be materialized.",
  );
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
  liveClaim?: {
    key: string;
    recoverySessionId: string | null;
    timestamp: number;
  },
): D1PreparedStatement {
  const stored = storedQuestionFields(question);
  const difficulty = structuralDifficulty(question);
  const reformulatedPrompt =
    metadata.promptVersion === "quiz-local-json-stream-v5.12"
      ? question.retryQuestion
      : (question.retryQuestion ?? question.question);
  if (!reformulatedPrompt) {
    throw new ApiError(
      422,
      "quiz_retry_question_invalid",
      "The AI-generated adaptive retry prompt must be present and distinct.",
    );
  }
  const columns = `(id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)`;
  const placeholders = `?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, ?`;
  const statement = liveClaim
    ? `INSERT INTO questions ${columns}
       SELECT ${placeholders}
       WHERE EXISTS (
         SELECT 1 FROM quiz_generation_claims claim
         WHERE claim.quiz_id = ? AND claim.claim_key = ? AND claim.lease_expires_at > ?
           AND (? IS NULL OR claim.recovery_session_id = ?)
       )`
    : `INSERT INTO questions
       ${columns}
       VALUES (${placeholders})`;
  return db.prepare(statement).bind(
    questionId,
    quizId,
    ordinal,
    question.id,
    question.type,
    question.id,
    question.question,
    reformulatedPrompt,
    stored.optionsJson,
    stored.correctAnswerJson,
    stored.rubricJson,
    stored.explanation,
    difficulty,
    JSON.stringify({
      source: "extension-local-tool",
      blueprintSlot: question.id,
      concept: question.concept,
      ...(question.claimKey ? { claimKey: question.claimKey } : {}),
      ...(question.conceptCluster
        ? { conceptCluster: question.conceptCluster }
        : {}),
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
    ...(liveClaim
      ? [
          quizId,
          liveClaim.key,
          liveClaim.timestamp,
          liveClaim.recoverySessionId,
          liveClaim.recoverySessionId,
        ]
      : []),
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
      ...(question.rubricV2 ? { v2: question.rubricV2 } : {}),
    }),
    explanation: question.explanation,
  };
}

function assertGroundedQuestionIdentity(
  question: LocalConceptQuizQuestion,
  accepted: { claimKey?: string }[],
): void {
  const claimKey = question.claimKey
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const conceptCluster = question.conceptCluster
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!claimKey || !conceptCluster) {
    throw new ApiError(
      422,
      "quiz_question_grounding_missing",
      "Grounded questions require a bounded claim identity.",
    );
  }
  if (
    accepted.some(
      (candidate) =>
        candidate.claimKey
          ?.normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/\s+/g, " ")
          .trim() === claimKey,
    )
  ) {
    throw new ApiError(
      422,
      "quiz_question_duplicate_claim",
      "The streamed question repeats an accepted instructional claim.",
    );
  }
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
  accepted: { concept: string }[],
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
