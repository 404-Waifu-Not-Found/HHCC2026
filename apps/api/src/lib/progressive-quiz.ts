import {
  AttemptGenerationAvailabilitySchema,
  GenerationAvailabilityReasonCodeSchema,
  LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LocalAcceptedQuestionSummarySchema,
  LocalGenerationProfileSchema,
  LocalQuestionPlanSchema,
  LocalQuizProgressiveImportVersionSchema,
  LocalQuizPromptVersionSchema,
  LocalQuizResultProtocolVersionSchema,
  LocalQuizValidatorVersionSchema,
  QuizQuestionTypesSchema,
  questionTypePlanForSelection,
  type AttemptGenerationAvailability,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizQuestionChunk,
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
  "this",
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
    questionPlanSeed: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    generationState: z.enum([
      "generating",
      "retrying",
      "retry_required",
      "ready",
    ]),
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
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
    if (value.reasonCode && value.generationState !== "retry_required") {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only an action-required summary may include a reason code.",
      });
    }
    if (value.plannedQuestionTypes.length !== value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["plannedQuestionTypes"],
        message: "The persisted question plan must match the planned total.",
      });
    }
    const stable = value.promptVersion === "quiz-local-json-stream-v5.2";
    const metadataMatches = stable
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
        | "questionPlan"
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
    JSON.stringify(
      chunk.questionPlan?.types ?? summary.plannedQuestionTypes,
    ) !== JSON.stringify(summary.plannedQuestionTypes) ||
    chunk.questionPlan?.seed !== summary.questionPlanSeed
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
});

export const PROGRESSIVE_GENERATION_STALE_AFTER_MS = 30 * 60 * 1_000;

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
      SELECT SUM(event.elapsed_ms + event.retry_delay_ms)
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
      SELECT MAX(event.created_at) FROM quiz_generation_call_events event
      WHERE event.quiz_id = qb.id
    ) AS last_attempt_at
    ,(
      SELECT claim.lease_expires_at FROM quiz_generation_claims claim
      WHERE claim.quiz_id = qb.id
    ) AS claim_lease_expires_at
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

  const summary = tryProgressiveQuizSummary(row.data.quality_summary_json);
  const telemetry = {
    available: row.data.call_count > 0,
    callCount: row.data.call_count,
    primaryCalls: row.data.primary_calls,
    automaticRetries: row.data.automatic_retries,
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
    };
  }

  const availability = generationAvailability(
    summary,
    row.data.quality_status,
    row.data.authoritative_count,
  );
  const stalled =
    (availability.state === "generating" ||
      availability.state === "retrying") &&
    Date.now() -
      Math.max(
        summary.lastQuestionAt,
        summary.stateChangedAt,
        telemetry.lastAttemptAt ?? 0,
      ) >
      PROGRESSIVE_GENERATION_STALE_AFTER_MS;

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
          state: "retry_required",
          reasonCode: "generation_stalled",
        })
      : availability,
    stalled,
    telemetry,
    claimLeaseExpiresAt: row.data.claim_lease_expires_at,
  };
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
  });
}

/**
 * Grade current progressive short answers without making a Worker-side model
 * call. DeepSeek supplies bounded rubric ideas and acceptable paraphrases while
 * generating the question in the extension; the authenticated API remains the
 * authoritative grader by comparing normalized semantic tokens. Pipeline-7
 * attempts keep their historical grader for compatibility.
 */
export function gradeProgressiveShortAnswer(input: {
  answer: string;
  requiredIdeas: string[];
  acceptableAlternatives: string[];
}): boolean {
  const formulaComparison = compareFormulaAnswer(
    input.answer,
    input.acceptableAlternatives,
  );
  if (formulaComparison === "match") return true;
  if (formulaComparison === "mismatch") return false;

  const normalizedAnswer = normalizeRubricText(input.answer);
  const answerTokens = rubricTokens(input.answer);
  if (!normalizedAnswer || answerTokens.size === 0) return false;

  const matchesAlternative = input.acceptableAlternatives.some(
    (alternative) => {
      const normalizedAlternative = normalizeRubricText(alternative);
      if (!normalizedAlternative) return false;
      if (
        normalizedAnswer === normalizedAlternative ||
        normalizedAnswer.includes(normalizedAlternative)
      ) {
        return true;
      }
      return tokenCoverage(answerTokens, rubricTokens(alternative), 0.67);
    },
  );
  if (matchesAlternative) return true;

  return input.requiredIdeas.every((idea) =>
    tokenCoverage(answerTokens, rubricTokens(idea), 0.5),
  );
}

function normalizeRubricText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
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
  const minimumMatches = expectedTokens.size === 1 ? 1 : 2;
  return (
    matching >= minimumMatches &&
    matching / expectedTokens.size >= requiredCoverage
  );
}
