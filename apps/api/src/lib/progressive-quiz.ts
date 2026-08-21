import {
  AttemptGenerationAvailabilitySchema,
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_VALIDATOR_VERSION,
  LocalAcceptedQuestionSummarySchema,
  QuizQuestionTypesSchema,
  questionTypePlanForSelection,
  type AttemptGenerationAvailability,
  type LocalConceptQuizQuestion,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "./errors";

const PlannedQuestionCountSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
]);

export const ProgressiveQuizSummarySchema = z
  .object({
    source: z.literal("extension-local-json-stream"),
    importVersion: z.literal(LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: z.literal(LOCAL_QUIZ_PROMPT_VERSION),
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
