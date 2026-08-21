import {
  AttemptGenerationAvailabilitySchema,
  GenerationRecoveryPhaseSchema,
  GenerationAvailabilityReasonCodeSchema,
  LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LocalAcceptedQuestionSummarySchema,
  LocalGenerationCallOutcomeSchema,
  LocalGenerationProfileSchema,
  LocalQuestionPlanSchema,
  LocalSourceSelectionMetricsSchema,
  LocalQuizProgressiveImportVersionSchema,
  LocalQuizPromptVersionSchema,
  LocalQuizResultProtocolVersionSchema,
  LocalQuizValidatorVersionSchema,
  QuizQuestionTypesSchema,
  questionTypePlanForSelection,
  type AttemptGenerationAvailability,
  type AutomaticRetryKind,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizQuestionChunk,
  type LocalGenerationCallOutcome,
  type LocalShortAnswerRubricV2,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "./errors";
import { compareFormulaAnswer } from "./math-expression";

const PlannedQuestionCountSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
]);

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "what",
  "when",
  "which",
  "with",
]);

const CJK_STOP_CHARACTERS = new Set([
  "一",
  "个",
  "为",
  "了",
  "以",
  "和",
  "在",
  "它",
  "是",
  "此",
  "的",
  "被",
  "这",
  "那",
]);

const TOKEN_ALIASES = new Map([
  ["approach", "limit"],
  ["approache", "limit"],
  ["approaches", "limit"],
  ["derivative", "rate"],
  ["divide", "ratio"],
  ["divid", "ratio"],
  ["divided", "ratio"],
  ["division", "ratio"],
  ["height", "value"],
  ["limiting", "limit"],
  ["quotient", "ratio"],
  ["smaller", "small"],
  ["tiny", "small"],
  ["carry", "transfer"],
  ["carried", "transfer"],
  ["transmit", "transfer"],
  ["transmitt", "transfer"],
  ["relay", "transfer"],
  ["send", "transfer"],
  ["sent", "transfer"],
  ["information", "signal"],
  ["data", "signal"],
  ["signal", "signal"],
  ["analyze", "process"],
  ["analyse", "process"],
  ["analyz", "process"],
  ["analysis", "process"],
  ["interpret", "process"],
  ["process", "process"],
  ["activate", "detect"],
  ["activat", "detect"],
  ["detect", "detect"],
  ["sense", "detect"],
  ["sens", "detect"],
]);

export const ProgressiveQuizSummarySchema = z
  .object({
    source: z.literal("extension-local-json-stream"),
    importVersion: LocalQuizProgressiveImportVersionSchema,
    resultProtocolVersion: LocalQuizResultProtocolVersionSchema.optional(),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.enum(["high", "none"]),
    promptVersion: LocalQuizPromptVersionSchema,
    validatorVersion: LocalQuizValidatorVersionSchema,
    generationProfile: LocalGenerationProfileSchema.optional(),
    generationId: z.string().uuid().optional(),
    generationSessionId: z.string().uuid().optional(),
    recoverySessionId: z.string().uuid().optional(),
    questionPlanSeed: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    promptFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    recoveryPhase: GenerationRecoveryPhaseSchema.optional(),
    activeCallIndex: z.number().int().min(0).max(255).optional(),
    sourceSelection: LocalSourceSelectionMetricsSchema.optional(),
    generationState: z.enum([
      "generating",
      "retrying",
      "recovering",
      "cooldown",
      "retry_required",
      "action_required",
      "generation_failed",
      "ready",
    ]),
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
    retryOrdinal: z.number().int().min(1).max(15).optional(),
    ordinalAttempt: z.number().int().min(1).max(24).optional(),
    retryKind: z
      .enum([
        "transport",
        "empty_content",
        "truncated_output",
        "content_repair",
        "duplicate_repair",
        "answer_repair",
        "automatic_resume",
      ])
      .optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).optional(),
    nextRecoveryAt: z.number().int().positive().optional(),
    requestedQuestionTypes: QuizQuestionTypesSchema,
    plannedQuestionTypes: z
      .array(z.enum(["multiple_choice", "true_false", "short_answer"]))
      .min(5)
      .max(15)
      .optional(),
    generatedQuestionTypes: z.array(
      z.enum(["multiple_choice", "true_false", "short_answer"]),
    ),
    plannedCount: PlannedQuestionCountSchema,
    acceptedCount: z.number().int().min(1).max(15),
    lastProgressAt: z.number().int().positive(),
    lastQuestionAt: z.number().int().positive().optional(),
    stateChangedAt: z.number().int().positive().optional(),
    telemetryAvailable: z.boolean().optional(),
    qualityFlags: z
      .array(
        z
          .object({
            ordinal: z.number().int().min(0).max(14),
            codes: z
              .array(
                z.enum([
                  "concept_overlap",
                  "low_structural_difficulty",
                  "high_structural_difficulty",
                  "similar_distractors",
                ]),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .max(15)
      .optional(),
    acceptedQuestionSummaries: z
      .array(LocalAcceptedQuestionSummarySchema)
      .min(1)
      .max(15),
    transcriptStored: z.literal(false),
    aiCalls: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    elapsedMs: z.number().int().positive(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    resultProtocolVersion:
      value.resultProtocolVersion ?? LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
    generationProfile:
      value.generationProfile ?? ("legacy_reasoning_v5_1" as const),
    plannedQuestionTypes:
      value.plannedQuestionTypes ??
      questionTypePlanForSelection(
        value.requestedQuestionTypes,
        value.plannedCount,
      ),
    lastQuestionAt: value.lastQuestionAt ?? value.lastProgressAt,
    stateChangedAt: value.stateChangedAt ?? value.lastProgressAt,
    telemetryAvailable: value.telemetryAvailable ?? false,
    qualityFlags: value.qualityFlags ?? [],
  }))
  .superRefine((value, context) => {
    if (
      value.acceptedCount !== value.acceptedQuestionSummaries.length ||
      value.acceptedCount !== value.generatedQuestionTypes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "Progressive summary counts must agree.",
      });
    }
    if (
      (value.generationState === "ready") !==
      (value.acceptedCount === value.plannedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["generationState"],
        message: "Only a complete progressive quiz may be ready.",
      });
    }
    if (
      value.reasonCode &&
      value.generationState !== "retry_required" &&
      value.generationState !== "cooldown" &&
      value.generationState !== "action_required" &&
      value.generationState !== "generation_failed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only an action-required summary may include a reason code.",
      });
    }
    const automaticProfile =
      value.generationProfile === "stable_auto_recovery_v5_3" ||
      value.generationProfile === "evidence_grounded_auto_v5_4" ||
      value.generationProfile === "concept_first_auto_v5_8";
    if (
      automaticProfile &&
      (value.generationState === "action_required" ||
        value.generationState === "generation_failed") &&
      !value.reasonCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message:
          "Terminal automatic-generation states require a bounded reason code.",
      });
    }
    const hasRetryMetadata =
      value.retryOrdinal !== undefined ||
      value.ordinalAttempt !== undefined ||
      value.retryKind !== undefined ||
      value.retryDelayMs !== undefined;
    if (
      value.generationState === "retrying" &&
      automaticProfile &&
      (!value.retryOrdinal || !value.ordinalAttempt || !value.retryKind)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Automatic retry summaries require ordinal metadata.",
      });
    }
    if (
      automaticProfile &&
      value.generationState !== "retrying" &&
      hasRetryMetadata
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message:
          "Only retrying automatic summaries may include retry metadata.",
      });
    }
    if (
      automaticProfile &&
      (value.generationState === "cooldown") !==
        (value.nextRecoveryAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextRecoveryAt"],
        message: "Automatic cooldown requires exactly one recovery time.",
      });
    }
    if (value.plannedQuestionTypes.length !== value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["plannedQuestionTypes"],
        message: "The persisted question plan must match the planned total.",
      });
    }
    const conceptFirstV58 =
      value.promptVersion === "quiz-local-json-stream-v5.8";
    const groundedV57 = value.promptVersion === "quiz-local-json-stream-v5.7";
    const groundedV56 = value.promptVersion === "quiz-local-json-stream-v5.6";
    const groundedV55 = value.promptVersion === "quiz-local-json-stream-v5.5";
    const groundedV54 = value.promptVersion === "quiz-local-json-stream-v5.4";
    const grounded = groundedV57 || groundedV56 || groundedV55 || groundedV54;
    const automatic = value.promptVersion === "quiz-local-json-stream-v5.3";
    const stable = value.promptVersion === "quiz-local-json-stream-v5.2";
    const metadataMatches = conceptFirstV58
      ? value.resultProtocolVersion === 9 &&
        value.importVersion === "extension-progressive-import-v7" &&
        value.reasoningEffort === "none" &&
        value.validatorVersion === "validator-local-progressive-v4.7" &&
        value.generationProfile === "concept_first_auto_v5_8" &&
        Boolean(value.generationId) &&
        Boolean(value.generationSessionId) &&
        Boolean(value.recoverySessionId) &&
        Boolean(value.questionPlanSeed) &&
        Boolean(value.promptFingerprint) &&
        value.telemetryAvailable
      : grounded
        ? value.resultProtocolVersion === 8 &&
          value.importVersion === "extension-progressive-import-v6" &&
          value.reasoningEffort === "none" &&
          value.validatorVersion ===
            (groundedV57
              ? "validator-local-progressive-v4.6"
              : groundedV56
                ? "validator-local-progressive-v4.5"
                : groundedV55
                  ? "validator-local-progressive-v4.4"
                  : "validator-local-progressive-v4.3") &&
          value.generationProfile === "evidence_grounded_auto_v5_4" &&
          Boolean(value.generationId) &&
          Boolean(value.generationSessionId) &&
          Boolean(value.recoverySessionId) &&
          Boolean(value.questionPlanSeed) &&
          value.telemetryAvailable
        : automatic
          ? value.resultProtocolVersion === 7 &&
            value.importVersion === "extension-progressive-import-v5" &&
            value.reasoningEffort === "none" &&
            value.validatorVersion === "validator-local-progressive-v4.2" &&
            value.generationProfile === "stable_auto_recovery_v5_3" &&
            Boolean(value.generationId) &&
            Boolean(value.generationSessionId) &&
            Boolean(value.recoverySessionId) &&
            Boolean(value.questionPlanSeed) &&
            value.telemetryAvailable
          : stable
            ? value.resultProtocolVersion === 6 &&
              value.importVersion === "extension-progressive-import-v4" &&
              value.reasoningEffort === "none" &&
              value.validatorVersion === "validator-local-progressive-v4.1" &&
              value.generationProfile === "stable_non_thinking_v5_2" &&
              Boolean(value.generationId) &&
              Boolean(value.questionPlanSeed) &&
              value.telemetryAvailable
            : value.resultProtocolVersion === 5 &&
              value.importVersion === "extension-progressive-import-v3" &&
              value.reasoningEffort === "high" &&
              value.validatorVersion === "validator-local-progressive-v4.0" &&
              value.generationProfile === "legacy_reasoning_v5_1";
    if (!metadataMatches) {
      context.addIssue({
        code: "custom",
        path: ["promptVersion"],
        message:
          "Progressive generation metadata versions must remain coherent.",
      });
    }
    value.acceptedQuestionSummaries.forEach((question, index) => {
      if (
        question.id !== `q${index + 1}` ||
        question.type !== value.plannedQuestionTypes[index] ||
        value.generatedQuestionTypes[index] !==
          value.plannedQuestionTypes[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["acceptedQuestionSummaries", index],
          message: "Accepted summaries must match the global question plan.",
        });
      }
    });
  });

export type ProgressiveQuizSummary = z.infer<
  typeof ProgressiveQuizSummarySchema
>;

export function assertProgressiveChunkMetadata(
  summary: ProgressiveQuizSummary,
  chunk: Pick<
    LocalConceptQuizQuestionChunk,
    "pipelineVersion" | "model" | "promptVersion" | "validatorVersion"
  > &
    Partial<
      Pick<
        LocalConceptQuizQuestionChunk,
        | "protocolVersion"
        | "reasoningEffort"
        | "importVersion"
        | "generationProfile"
        | "generationId"
        | "generationSessionId"
        | "recoverySessionId"
        | "questionPlan"
        | "promptFingerprint"
      >
    >,
): void {
  if (
    (chunk.protocolVersion ?? LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION) !==
      summary.resultProtocolVersion ||
    chunk.pipelineVersion !== summary.pipelineVersion ||
    chunk.model !== summary.model ||
    (chunk.reasoningEffort ?? "high") !== summary.reasoningEffort ||
    chunk.promptVersion !== summary.promptVersion ||
    chunk.validatorVersion !== summary.validatorVersion ||
    (chunk.importVersion ?? "extension-progressive-import-v3") !==
      summary.importVersion ||
    (chunk.generationProfile ?? "legacy_reasoning_v5_1") !==
      summary.generationProfile ||
    chunk.generationId !== summary.generationId ||
    chunk.generationSessionId !== summary.generationSessionId ||
    chunk.recoverySessionId !== summary.recoverySessionId ||
    JSON.stringify(
      chunk.questionPlan?.types ?? summary.plannedQuestionTypes,
    ) !== JSON.stringify(summary.plannedQuestionTypes) ||
    chunk.questionPlan?.seed !== summary.questionPlanSeed ||
    chunk.promptFingerprint !== summary.promptFingerprint
  ) {
    throw new ApiError(
      409,
      "quiz_generation_metadata_mismatch",
      "Every streamed question must use the quiz's original generation metadata.",
    );
  }
}

const ProgressiveGenerationSnapshotRowSchema = z.object({
  quiz_id: z.string().uuid(),
  pipeline_version: z.number().int(),
  quality_status: z.string(),
  quality_summary_json: z.string(),
  authoritative_count: z.coerce.number().int().nonnegative(),
  call_count: z.coerce.number().int().nonnegative().default(0),
  primary_calls: z.coerce.number().int().nonnegative().default(0),
  automatic_retries: z.coerce.number().int().nonnegative().default(0),
  automatic_recoveries: z.coerce.number().int().nonnegative().default(0),
  manual_continuations: z.coerce.number().int().nonnegative().default(0),
  partial_calls: z.coerce.number().int().nonnegative().default(0),
  complete_usage_calls: z.coerce.number().int().nonnegative().default(0),
  total_elapsed_ms: z.coerce.number().int().nonnegative().default(0),
  total_input_tokens: z.coerce.number().int().nonnegative().default(0),
  total_output_tokens: z.coerce.number().int().nonnegative().default(0),
  total_reasoning_tokens: z.coerce.number().int().nonnegative().default(0),
  outcome_counts_json: z.string().default("{}"),
  first_question_latency_ms: z.coerce
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null),
  last_attempt_at: z.coerce.number().int().positive().nullable().default(null),
  claim_lease_expires_at: z.coerce
    .number()
    .int()
    .positive()
    .nullable()
    .default(null),
  claim_recovery_session_id: z.string().uuid().nullable().default(null),
  claim_heartbeat_at: z.coerce
    .number()
    .int()
    .positive()
    .nullable()
    .default(null),
  next_ordinal_attempt: z.coerce.number().int().min(1).max(24).default(1),
  next_retry_kind: z
    .enum([
      "transport",
      "empty_content",
      "truncated_output",
      "content_repair",
      "duplicate_repair",
      "answer_repair",
      "automatic_resume",
    ])
    .nullable()
    .default(null),
  latest_generation_session_id: z.string().uuid().nullable().default(null),
  next_call_index: z.coerce.number().int().min(0).max(128).default(0),
  active_call_count: z.coerce.number().int().nonnegative().default(0),
  active_call_index: z.coerce
    .number()
    .int()
    .min(0)
    .max(255)
    .nullable()
    .default(null),
  active_call_start_ordinal: z.coerce
    .number()
    .int()
    .min(0)
    .max(14)
    .nullable()
    .default(null),
  active_call_ordinal_attempt: z.coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .nullable()
    .default(null),
  retry_ordinals_json: z.string().default("[]"),
  previous_outcome: LocalGenerationCallOutcomeSchema.nullable().default(null),
});

export const PROGRESSIVE_GENERATION_STALE_AFTER_MS = 30 * 60 * 1_000;
export const AUTOMATIC_GENERATION_STALE_AFTER_MS = 45 * 1_000;

const AUTOMATIC_RETRY_OUTCOMES_BY_KIND = {
  transport: [
    "transient_http",
    "network_interrupted",
    "timeout",
    "call_dispatch_timeout",
    "stream_idle_timeout",
  ],
  empty_content: ["empty_content"],
  truncated_output: ["truncated_json", "finish_length"],
  content_repair: [
    "schema_invalid",
    "type_or_order_mismatch",
    "source_framing_invalid",
    "course_logistics_invalid",
    "low_pedagogical_value",
    "rubric_invalid",
    "question_tautology_invalid",
    "quiz_language_mismatch",
  ],
  duplicate_repair: ["duplicate_question"],
  answer_repair: [
    "answer_mapping_invalid",
    "mc_evidence_span_invalid",
    "mc_distractor_duplicate",
    "mc_distractor_equivalent",
    "mc_answer_kind_mismatch",
    "mc_question_answer_mismatch",
    "true_false_fact_invalid",
    "true_false_mutation_unavailable",
    "short_atomic_invalid",
    "short_proposition_invalid",
    "short_enumeration_invalid",
    "short_formula_invalid",
    "question_answer_kind_mismatch",
  ],
  automatic_resume: ["local_state_conflict", "append_conflict"],
} as const satisfies Record<
  AutomaticRetryKind,
  readonly LocalGenerationCallOutcome[]
>;

export function automaticRetryKindForOutcome(
  outcome: string,
): AutomaticRetryKind | null {
  for (const [kind, outcomes] of Object.entries(
    AUTOMATIC_RETRY_OUTCOMES_BY_KIND,
  ) as [AutomaticRetryKind, readonly string[]][]) {
    if (outcomes.includes(outcome)) {
      return kind;
    }
  }
  return null;
}

export function retryKindMatchesGenerationOutcome(
  retryKind: AutomaticRetryKind | undefined,
  outcome: string,
): boolean {
  return retryKind
    ? AUTOMATIC_RETRY_OUTCOMES_BY_KIND[retryKind].some(
        (candidate) => candidate === outcome,
      )
    : false;
}

const AUTOMATIC_RETRY_KIND_SQL_CASE = Object.entries(
  AUTOMATIC_RETRY_OUTCOMES_BY_KIND,
)
  .map(
    ([kind, outcomes]) =>
      `WHEN event.outcome_code IN (${outcomes
        .map((outcome) => `'${outcome.replaceAll("'", "''")}'`)
        .join(", ")}) THEN '${kind}'`,
  )
  .join("\n        ");

export const PROGRESSIVE_GENERATION_SNAPSHOT_SQL = `
  SELECT
    qb.id AS quiz_id,
    qb.pipeline_version,
    qb.quality_status,
    qb.quality_summary_json,
    (
      SELECT COUNT(*)
      FROM questions stored_question
      WHERE stored_question.quiz_id = qb.id
    ) AS authoritative_count
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ) AS call_count
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id AND event.classification = 'primary'
    ) AS primary_calls
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id AND event.classification = 'automatic_retry'
    ) AS automatic_retries
    ,(
      SELECT CASE
        WHEN COUNT(DISTINCT event.recovery_session_id) > 0
          THEN MAX(
            0,
            COUNT(DISTINCT event.recovery_session_id) - CASE
              WHEN EXISTS (
                SELECT 1
                FROM quiz_generation_call_events initial
                WHERE initial.quiz_id = qb.id
                  AND initial.protocol_version IN (7, 8, 9)
                  AND initial.call_index = 0
              ) THEN 1
              ELSE 0
            END
          )
        ELSE 0
      END
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id AND event.recovery_session_id IS NOT NULL
    ) AS automatic_recoveries
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id AND event.classification = 'manual_continuation'
    ) AS manual_continuations
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.accepted_count > 0
        AND event.accepted_count < event.requested_count
    ) AS partial_calls
    ,(
      SELECT COUNT(*) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id AND event.usage_complete = 1
    ) AS complete_usage_calls
    ,COALESCE((
      SELECT SUM(
        CASE
          WHEN COALESCE(event.lifecycle_state, 'completed') = 'abandoned'
            THEN MIN(event.elapsed_ms, 120000)
          ELSE event.elapsed_ms
        END + event.retry_delay_ms
      )
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ), 0) AS total_elapsed_ms
    ,COALESCE((
      SELECT SUM(event.input_tokens) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ), 0) AS total_input_tokens
    ,COALESCE((
      SELECT SUM(event.output_tokens) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ), 0) AS total_output_tokens
    ,COALESCE((
      SELECT SUM(event.reasoning_tokens) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ), 0) AS total_reasoning_tokens
    ,COALESCE((
      SELECT json_group_object(outcome_code, outcome_total)
      FROM (
        SELECT event.outcome_code, COUNT(*) AS outcome_total
        FROM quiz_generation_call_events event
        WHERE event.quiz_id = qb.id
          AND COALESCE(event.lifecycle_state, 'completed') <> 'started'
        GROUP BY event.outcome_code
      ) outcome_counts
    ), '{}') AS outcome_counts_json
    ,(
      SELECT SUM(event.elapsed_ms + event.retry_delay_ms)
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.call_index <= (
          SELECT MIN(accepted.call_index)
          FROM quiz_generation_call_events accepted
          WHERE accepted.quiz_id = qb.id
            AND accepted.start_ordinal = 0
            AND accepted.accepted_count > 0
        )
    ) AS first_question_latency_ms
    ,(
      SELECT MAX(COALESCE(event.dispatched_at, event.created_at)) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ) AS last_attempt_at
    ,(
      SELECT claim.lease_expires_at FROM quiz_generation_claims claim
      WHERE claim.quiz_id = qb.id
    ) AS claim_lease_expires_at
    ,(
      SELECT claim.recovery_session_id FROM quiz_generation_claims claim
      WHERE claim.quiz_id = qb.id
    ) AS claim_recovery_session_id
    ,(
      SELECT claim.heartbeat_at FROM quiz_generation_claims claim
      WHERE claim.quiz_id = qb.id
    ) AS claim_heartbeat_at
    ,MIN(COALESCE((
      SELECT MAX(event.ordinal_attempt) + 1
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.protocol_version IN (7, 8, 9)
        AND COALESCE(event.lifecycle_state, 'completed') <> 'started'
        AND event.start_ordinal = (
          SELECT COUNT(*) FROM questions stored_question
          WHERE stored_question.quiz_id = qb.id
        )
    ), 1), 24) AS next_ordinal_attempt
    ,(
      SELECT CASE
        ${AUTOMATIC_RETRY_KIND_SQL_CASE}
        ELSE NULL
      END
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.protocol_version IN (7, 8, 9)
        AND COALESCE(event.lifecycle_state, 'completed') <> 'started'
        AND event.start_ordinal = (
          SELECT COUNT(*) FROM questions stored_question
          WHERE stored_question.quiz_id = qb.id
        )
      ORDER BY event.call_index DESC
      LIMIT 1
    ) AS next_retry_kind
    ,(
      SELECT event.generation_session_id
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
      ORDER BY event.created_at DESC, event.call_index DESC
      LIMIT 1
    ) AS latest_generation_session_id
    ,COALESCE((
      SELECT MAX(event.call_index) + 1
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.generation_session_id = (
          SELECT latest.generation_session_id
          FROM quiz_generation_call_events latest
          WHERE latest.quiz_id = qb.id
          ORDER BY latest.created_at DESC, latest.call_index DESC
          LIMIT 1
        )
    ), 0) AS next_call_index
    ,(
      SELECT COUNT(*)
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.lifecycle_state = 'started'
    ) AS active_call_count
    ,(
      SELECT event.call_index
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.lifecycle_state = 'started'
      ORDER BY event.call_index DESC
      LIMIT 1
    ) AS active_call_index
    ,(
      SELECT event.start_ordinal
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.lifecycle_state = 'started'
      ORDER BY event.call_index DESC
      LIMIT 1
    ) AS active_call_start_ordinal
    ,(
      SELECT COALESCE(event.ordinal_attempt, 1)
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND event.lifecycle_state = 'started'
      ORDER BY event.call_index DESC
      LIMIT 1
    ) AS active_call_ordinal_attempt
    ,COALESCE((
      SELECT json_group_array(attempted.ordinal)
      FROM (
        SELECT DISTINCT event.start_ordinal + offsets.offset + 1 AS ordinal
        FROM quiz_generation_call_events event
        JOIN (
          SELECT 0 AS offset UNION ALL SELECT 1 UNION ALL SELECT 2
        ) offsets ON offsets.offset < event.requested_count
        WHERE event.quiz_id = qb.id
          AND COALESCE(event.lifecycle_state, 'completed') <> 'started'
          AND event.start_ordinal + offsets.offset >= (
            SELECT COUNT(*) FROM questions stored_question
            WHERE stored_question.quiz_id = qb.id
          )
          AND (
            event.outcome_code <> 'complete'
            OR event.accepted_count < event.requested_count
          )
        ORDER BY ordinal
      ) attempted
    ), '[]') AS retry_ordinals_json
    ,(
      SELECT event.outcome_code
      FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
        AND COALESCE(event.lifecycle_state, 'completed') <> 'started'
        AND event.start_ordinal <= (
          SELECT COUNT(*) FROM questions stored_question
          WHERE stored_question.quiz_id = qb.id
        )
        AND event.start_ordinal + event.requested_count > (
          SELECT COUNT(*) FROM questions stored_question
          WHERE stored_question.quiz_id = qb.id
        )
      ORDER BY event.created_at DESC, event.call_index DESC
      LIMIT 1
    ) AS previous_outcome
  FROM quiz_banks qb
  WHERE qb.id = ?
  LIMIT 1`;

export type ProgressiveGenerationSnapshot = {
  quizId: string;
  pipelineVersion: number;
  qualityStatus: string;
  /** Exact stored value for optimistic compare-and-swap writes. */
  qualitySummaryJson: string;
  authoritativeCount: number;
  summary: ProgressiveQuizSummary | null;
  availability: AttemptGenerationAvailability | null;
  stalled: boolean;
  telemetry: {
    available: boolean;
    callCount: number;
    primaryCalls: number;
    automaticRetries: number;
    automaticRecoveries: number;
    manualContinuations: number;
    partialCalls: number;
    completeUsageCalls: number;
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    outcomeCounts: Record<string, number>;
    firstQuestionLatencyMs: number | null;
    lastAttemptAt: number | null;
  };
  claimLeaseExpiresAt: number | null;
  claimRecoverySessionId: string | null;
  claimHeartbeatAt: number | null;
  nextOrdinalAttempt: number;
  nextRetryKind:
    | "transport"
    | "empty_content"
    | "truncated_output"
    | "content_repair"
    | "duplicate_repair"
    | "answer_repair"
    | "automatic_resume"
    | null;
  latestGenerationSessionId: string | null;
  nextCallIndex: number;
  activeCall: {
    lifecycleState: "started";
    callIndex: number;
    startIndex: number;
    ordinalAttempt: number;
  } | null;
  retryOrdinals: number[];
  previousOutcome: LocalGenerationCallOutcome | null;
};

/**
 * Read the mutable progressive bank state and its stored question count from a
 * single D1 statement. D1 gives each statement one coherent database snapshot,
 * so callers never compare an older summary with a count observed after an
 * append commits.
 */
export async function readProgressiveGenerationSnapshot(
  db: D1Database,
  quizId: string,
): Promise<ProgressiveGenerationSnapshot> {
  const raw = await db
    .prepare(PROGRESSIVE_GENERATION_SNAPSHOT_SQL)
    .bind(quizId)
    .first();
  const row = ProgressiveGenerationSnapshotRowSchema.safeParse(raw);
  if (!row.success) {
    throw new ApiError(404, "quiz_not_found", "Quiz not found.");
  }
  if (
    row.data.active_call_count > 1 ||
    (row.data.active_call_count === 1 &&
      (row.data.active_call_index === null ||
        row.data.active_call_start_ordinal === null ||
        row.data.active_call_ordinal_attempt === null))
  ) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "The quiz has conflicting active generation lifecycles.",
    );
  }
  const activeCall =
    row.data.active_call_count === 1
      ? {
          lifecycleState: "started" as const,
          callIndex: row.data.active_call_index!,
          startIndex: row.data.active_call_start_ordinal!,
          ordinalAttempt: row.data.active_call_ordinal_attempt!,
        }
      : null;

  const summary = tryProgressiveQuizSummary(row.data.quality_summary_json);
  const telemetry = {
    available: row.data.call_count > 0,
    callCount: row.data.call_count,
    primaryCalls: row.data.primary_calls,
    automaticRetries: row.data.automatic_retries,
    automaticRecoveries: row.data.automatic_recoveries,
    manualContinuations: row.data.manual_continuations,
    partialCalls: row.data.partial_calls,
    completeUsageCalls: row.data.complete_usage_calls,
    elapsedMs: row.data.total_elapsed_ms,
    inputTokens: row.data.total_input_tokens,
    outputTokens: row.data.total_output_tokens,
    reasoningTokens: row.data.total_reasoning_tokens,
    outcomeCounts: parseOutcomeCounts(row.data.outcome_counts_json),
    firstQuestionLatencyMs: row.data.first_question_latency_ms,
    lastAttemptAt: row.data.last_attempt_at,
  };
  if (!summary) {
    return {
      quizId: row.data.quiz_id,
      pipelineVersion: row.data.pipeline_version,
      qualityStatus: row.data.quality_status,
      qualitySummaryJson: row.data.quality_summary_json,
      authoritativeCount: row.data.authoritative_count,
      summary: null,
      availability: null,
      stalled: false,
      telemetry,
      claimLeaseExpiresAt: row.data.claim_lease_expires_at,
      claimRecoverySessionId: row.data.claim_recovery_session_id,
      claimHeartbeatAt: row.data.claim_heartbeat_at,
      nextOrdinalAttempt: row.data.next_ordinal_attempt,
      nextRetryKind: row.data.next_retry_kind,
      latestGenerationSessionId: row.data.latest_generation_session_id,
      nextCallIndex: row.data.next_call_index,
      activeCall,
      retryOrdinals: parseRetryOrdinals(row.data.retry_ordinals_json),
      previousOutcome: row.data.previous_outcome,
    };
  }

  const availability = generationAvailability(
    summary,
    row.data.quality_status,
    row.data.authoritative_count,
  );
  const automatic =
    summary.generationProfile === "stable_auto_recovery_v5_3" ||
    summary.generationProfile === "evidence_grounded_auto_v5_4" ||
    summary.generationProfile === "concept_first_auto_v5_8" ||
    summary.resultProtocolVersion === 5;
  const stalled =
    (availability.state === "generating" ||
      availability.state === "retrying" ||
      availability.state === "recovering") &&
    Date.now() -
      Math.max(
        summary.lastQuestionAt,
        summary.stateChangedAt,
        telemetry.lastAttemptAt ?? 0,
      ) >
      (automatic
        ? AUTOMATIC_GENERATION_STALE_AFTER_MS
        : PROGRESSIVE_GENERATION_STALE_AFTER_MS) &&
    (!automatic || (row.data.claim_lease_expires_at ?? 0) <= Date.now());

  return {
    quizId: row.data.quiz_id,
    pipelineVersion: row.data.pipeline_version,
    qualityStatus: row.data.quality_status,
    qualitySummaryJson: row.data.quality_summary_json,
    authoritativeCount: row.data.authoritative_count,
    summary,
    availability: stalled
      ? AttemptGenerationAvailabilitySchema.parse({
          ...availability,
          state: automatic ? "recovering" : "retry_required",
          ...(automatic ? {} : { reasonCode: "generation_stalled" }),
        })
      : availability,
    stalled,
    telemetry,
    claimLeaseExpiresAt: row.data.claim_lease_expires_at,
    claimRecoverySessionId: row.data.claim_recovery_session_id,
    claimHeartbeatAt: row.data.claim_heartbeat_at,
    nextOrdinalAttempt: row.data.next_ordinal_attempt,
    nextRetryKind: row.data.next_retry_kind,
    latestGenerationSessionId: row.data.latest_generation_session_id,
    nextCallIndex: row.data.next_call_index,
    activeCall,
    retryOrdinals: parseRetryOrdinals(row.data.retry_ordinals_json),
    previousOutcome: row.data.previous_outcome,
  };
}

function parseRetryOrdinals(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed)]
      .filter(
        (ordinal): ordinal is number =>
          Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 15,
      )
      .sort((left, right) => left - right);
  } catch {
    return [];
  }
}

function parseOutcomeCounts(value: string): Record<string, number> {
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([code, count]) =>
          /^[a-z0-9_]{1,64}$/.test(code) &&
          Number.isInteger(count) &&
          Number(count) >= 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function acceptedQuestionSummary(question: LocalConceptQuizQuestion) {
  return LocalAcceptedQuestionSummarySchema.parse({
    id: question.id,
    type: question.type,
    concept: question.concept,
    question: question.question,
    ...(question.claimKey ? { claimKey: question.claimKey } : {}),
    ...(question.conceptCluster
      ? { conceptCluster: question.conceptCluster }
      : {}),
  });
}

export function parseProgressiveQuizSummary(
  value: string,
): ProgressiveQuizSummary {
  try {
    return ProgressiveQuizSummarySchema.parse(JSON.parse(value));
  } catch {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This quiz does not support current progressive question delivery.",
    );
  }
}

export function tryProgressiveQuizSummary(
  value: string,
): ProgressiveQuizSummary | null {
  try {
    const parsed = ProgressiveQuizSummarySchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function generationAvailability(
  summary: ProgressiveQuizSummary,
  qualityStatus: string,
  authoritativeCount: number,
): AttemptGenerationAvailability {
  if (authoritativeCount !== summary.acceptedCount) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "Stored question counts do not match generation state.",
    );
  }
  const ready =
    qualityStatus === "passed" && authoritativeCount === summary.plannedCount;
  if ((summary.generationState === "ready") !== ready) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "Quiz quality and generation state do not agree.",
    );
  }
  return AttemptGenerationAvailabilitySchema.parse({
    state: ready ? "ready" : summary.generationState,
    availableQuestions: authoritativeCount,
    totalQuestions: summary.plannedCount,
    ...(!ready && summary.reasonCode ? { reasonCode: summary.reasonCode } : {}),
    ...(!ready && summary.retryOrdinal
      ? { retryOrdinal: summary.retryOrdinal }
      : {}),
    ...(!ready && summary.ordinalAttempt
      ? { ordinalAttempt: summary.ordinalAttempt }
      : {}),
    ...(!ready && summary.retryKind ? { retryKind: summary.retryKind } : {}),
    ...(!ready && summary.retryDelayMs !== undefined
      ? { retryDelayMs: summary.retryDelayMs }
      : {}),
    ...(!ready && summary.recoverySessionId
      ? { recoverySessionId: summary.recoverySessionId }
      : {}),
    ...(!ready && summary.nextRecoveryAt
      ? { nextRecoveryAt: new Date(summary.nextRecoveryAt).toISOString() }
      : {}),
    ...(!ready && summary.recoveryPhase
      ? { recoveryPhase: summary.recoveryPhase }
      : {}),
    ...(!ready && summary.activeCallIndex !== undefined
      ? { activeCallIndex: summary.activeCallIndex }
      : {}),
  });
}

/**
 * Grade current progressive short answers without making a Worker-side model
 * call. DeepSeek supplies bounded rubric ideas and acceptable paraphrases while
 * generating the question in the extension; the authenticated API remains the
 * authoritative grader by comparing normalized semantic tokens. Pipeline-7
 * attempts keep their historical grader for compatibility.
 */
export type ProgressiveShortAnswerGradingPath =
  | "atomic_exact"
  | "formula_match"
  | "formula_mismatch"
  | "prose_alternative"
  | "required_ideas"
  | "required_idea_missing"
  | "enumeration_match"
  | "enumeration_mismatch";

export type ProgressiveShortAnswerDecision = {
  correct: boolean;
  path: ProgressiveShortAnswerGradingPath;
};

export function gradeProgressiveShortAnswerDecision(input: {
  answer: string;
  requiredIdeas: string[];
  acceptableAlternatives: string[];
  rubricV2?: LocalShortAnswerRubricV2;
}): ProgressiveShortAnswerDecision {
  if (input.rubricV2?.mode === "atomic_term") {
    const learner = canonicalExactAlternative(input.answer);
    const accepted = [
      input.rubricV2.canonicalAnswer,
      ...input.rubricV2.aliases,
    ];
    return learner &&
      accepted.some(
        (candidate) => canonicalExactAlternative(candidate) === learner,
      )
      ? { correct: true, path: "atomic_exact" }
      : { correct: false, path: "required_idea_missing" };
  }
  if (input.rubricV2?.mode === "enumeration") {
    return gradeEnumerationAnswer(input.answer, input.rubricV2);
  }
  const formulaAlternatives =
    input.rubricV2?.mode === "formula"
      ? [input.rubricV2.canonicalFormula, ...input.rubricV2.acceptableFormulas]
      : input.acceptableAlternatives;
  const formulaComparison = compareFormulaAnswer(
    input.answer,
    formulaAlternatives,
  );
  if (formulaComparison === "match") {
    return { correct: true, path: "formula_match" };
  }
  if (formulaComparison === "mismatch") {
    return { correct: false, path: "formula_mismatch" };
  }

  const canonicalAnswer = canonicalExactAlternative(input.answer);
  if (
    canonicalAnswer &&
    input.acceptableAlternatives.some(
      (alternative) =>
        canonicalExactAlternative(alternative) === canonicalAnswer,
    )
  ) {
    return { correct: true, path: "atomic_exact" };
  }

  const requiredIdeas =
    input.rubricV2?.mode === "proposition"
      ? input.rubricV2.requiredIdeas
      : input.requiredIdeas;
  const acceptableAlternatives =
    input.rubricV2?.mode === "proposition"
      ? input.rubricV2.acceptableAnswers
      : input.acceptableAlternatives;
  const normalizedAnswer = normalizeRubricText(input.answer);
  const answerTokens = rubricTokens(input.answer);
  if (!normalizedAnswer || answerTokens.size < 2) {
    return { correct: false, path: "required_idea_missing" };
  }

  const matchesAlternative = acceptableAlternatives.some((alternative) =>
    tokenCoverage(answerTokens, rubricTokens(alternative), 0.67),
  );
  if (matchesAlternative) {
    return { correct: true, path: "prose_alternative" };
  }

  const coversRequiredIdeas = requiredIdeas.every((idea) =>
    tokenCoverage(answerTokens, rubricTokens(idea), 0.5),
  );
  return coversRequiredIdeas
    ? { correct: true, path: "required_ideas" }
    : { correct: false, path: "required_idea_missing" };
}

export function gradeProgressiveShortAnswer(input: {
  answer: string;
  requiredIdeas: string[];
  acceptableAlternatives: string[];
  rubricV2?: LocalShortAnswerRubricV2;
}): boolean {
  return gradeProgressiveShortAnswerDecision(input).correct;
}

function gradeEnumerationAnswer(
  answer: string,
  rubric: Extract<LocalShortAnswerRubricV2, { mode: "enumeration" }>,
): ProgressiveShortAnswerDecision {
  const segments = normalizeRubricText(answer)
    .split(/(?:[,;\n]|\band\b|\bor\b|、|，|；|和|以及)+/gu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < rubric.requiredCardinality) {
    return { correct: false, path: "enumeration_mismatch" };
  }
  const used = new Set<number>();
  const matched = rubric.requiredItems.every((item, itemIndex) => {
    const candidates = [item, ...(rubric.aliasesByItem[itemIndex] ?? [])];
    const segmentIndex = segments.findIndex(
      (segment, index) =>
        !used.has(index) &&
        candidates.some((candidate) => {
          const exact = canonicalExactAlternative(candidate);
          return (
            (exact && canonicalExactAlternative(segment) === exact) ||
            tokenCoverage(rubricTokens(segment), rubricTokens(candidate), 1)
          );
        }),
    );
    if (segmentIndex < 0) return false;
    used.add(segmentIndex);
    return true;
  });
  return matched && used.size === rubric.requiredCardinality
    ? { correct: true, path: "enumeration_match" }
    : { correct: false, path: "enumeration_mismatch" };
}

function normalizeRubricText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\bcentral nervous system\b/gu, " cns ")
    .replace(/\bperipheral nervous system\b/gu, " pns ")
    .replace(/\bdeoxyribonucleic acid\b/gu, " dna ")
    .replace(/\bribonucleic acid\b/gu, " rna ")
    .replace(/\bpick(?:s|ed|ing)?\s+up\b/gu, " detect ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function rubricTokens(value: string): Set<string> {
  const normalized = normalizeRubricText(value);
  const tokens = new Set<string>();
  for (const rawToken of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(rawToken)) {
      addCjkTokens(tokens, rawToken);
      continue;
    }
    const canonical = canonicalEnglishToken(rawToken);
    if (canonical) tokens.add(canonical);
  }
  return tokens;
}

/**
 * Canonicalize a complete answer candidate for exact equality. This is
 * deliberately narrower than fuzzy rubric coverage: articles, harmless
 * inflection, approved acronyms, and approved aliases may differ, but a
 * substring or token subset is never accepted.
 */
function canonicalExactAlternative(value: string): string {
  const normalized = normalizeRubricText(value);
  const canonical: string[] = [];
  for (const rawToken of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(rawToken)) {
      const meaningful = [...rawToken].filter(
        (character) => !CJK_STOP_CHARACTERS.has(character),
      );
      if (meaningful.length) canonical.push(meaningful.join(""));
      continue;
    }
    const token = canonicalEnglishToken(rawToken);
    if (token) canonical.push(token);
  }
  return canonical.join(" ");
}

function addCjkTokens(tokens: Set<string>, value: string): void {
  const meaningful = [...value].filter(
    (character) =>
      /[\u3400-\u9fff\uf900-\ufaff]/u.test(character) &&
      !CJK_STOP_CHARACTERS.has(character),
  );
  meaningful.forEach((character) => tokens.add(character));
  for (let index = 0; index + 1 < meaningful.length; index += 1) {
    tokens.add(`${meaningful[index]}${meaningful[index + 1]}`);
  }
}

function canonicalEnglishToken(value: string): string | null {
  if (ENGLISH_STOP_WORDS.has(value)) return null;
  const directAlias = TOKEN_ALIASES.get(value);
  if (directAlias) return directAlias;
  let token = value;
  if (token.length > 5 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 4 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith("es")) {
    token = /(ches|shes|sses|xes|zes)$/u.test(token)
      ? token.slice(0, -2)
      : token.slice(0, -1);
  } else if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us")
  ) {
    token = token.slice(0, -1);
  }
  return TOKEN_ALIASES.get(token) ?? token;
}

function tokenCoverage(
  answerTokens: Set<string>,
  expectedTokens: Set<string>,
  requiredCoverage: number,
): boolean {
  if (expectedTokens.size === 0) return false;
  let matching = 0;
  for (const token of expectedTokens) {
    if (answerTokens.has(token)) matching += 1;
  }
  const minimumMatches = 2;
  return (
    matching >= minimumMatches &&
    matching / expectedTokens.size >= requiredCoverage
  );
}
