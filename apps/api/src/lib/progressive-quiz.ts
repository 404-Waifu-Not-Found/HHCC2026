import {
  AttemptGenerationAvailabilitySchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  LocalAcceptedQuestionSummarySchema,
  LocalQuizPromptVersionSchema,
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
    importVersion: z.literal(LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: LocalQuizPromptVersionSchema,
    validatorVersion: z.literal(LOCAL_QUIZ_VALIDATOR_VERSION),
    generationState: z.enum([
      "generating",
      "retrying",
      "retry_required",
      "ready",
    ]),
    reasonCode: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .optional(),
    requestedQuestionTypes: QuizQuestionTypesSchema,
    generatedQuestionTypes: z.array(
      z.enum(["multiple_choice", "true_false", "short_answer"]),
    ),
    plannedCount: PlannedQuestionCountSchema,
    acceptedCount: z.number().int().min(1).max(15),
    lastProgressAt: z.number().int().positive(),
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
    const expectedTypes = questionTypePlanForSelection(
      value.requestedQuestionTypes,
      value.plannedCount,
    );
    value.acceptedQuestionSummaries.forEach((question, index) => {
      if (
        question.id !== `q${index + 1}` ||
        question.type !== expectedTypes[index] ||
        value.generatedQuestionTypes[index] !== expectedTypes[index]
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
  >,
): void {
  if (
    chunk.pipelineVersion !== summary.pipelineVersion ||
    chunk.model !== summary.model ||
    chunk.promptVersion !== summary.promptVersion ||
    chunk.validatorVersion !== summary.validatorVersion
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
  FROM quiz_banks qb
  WHERE qb.id = ?
  LIMIT 1`;

export type ProgressiveGenerationSnapshot = {
  quizId: string;
  pipelineVersion: number;
  qualityStatus: string;
  authoritativeCount: number;
  summary: ProgressiveQuizSummary | null;
  availability: AttemptGenerationAvailability | null;
  stalled: boolean;
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
  if (!summary) {
    return {
      quizId: row.data.quiz_id,
      pipelineVersion: row.data.pipeline_version,
      qualityStatus: row.data.quality_status,
      authoritativeCount: row.data.authoritative_count,
      summary: null,
      availability: null,
      stalled: false,
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
    Date.now() - summary.lastProgressAt > PROGRESSIVE_GENERATION_STALE_AFTER_MS;

  return {
    quizId: row.data.quiz_id,
    pipelineVersion: row.data.pipeline_version,
    qualityStatus: row.data.quality_status,
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
  };
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
