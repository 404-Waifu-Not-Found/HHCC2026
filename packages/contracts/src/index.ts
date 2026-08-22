import { z } from "zod";

// Keep the emitted ESM directly executable in Node-based QA tools. TypeScript
// resolves this .js specifier to admin.ts while the compiled package retains
// the extension Node requires at runtime.
export * from "./admin.js";

export const SourceSchema = z.literal("youtube");
export type VideoSource = z.infer<typeof SourceSchema>;

export const LanguageSchema = z.enum(["en", "zh-CN"]);
export type AppLanguage = z.infer<typeof LanguageSchema>;

export const SessionLengthSchema = z.enum([
  "short",
  "medium",
  "long",
  "custom",
]);
export type SessionLength = z.infer<typeof SessionLengthSchema>;
export const QUESTION_COUNT_MIN = 5;
export const QUESTION_COUNT_MAX = 50;
export const QuestionCountSchema = z
  .number()
  .int()
  .min(QUESTION_COUNT_MIN)
  .max(QUESTION_COUNT_MAX);

export const QuizQuestionTypeSchema = z.enum([
  "multiple_choice",
  "true_false",
  "short_answer",
]);
export type QuizQuestionType = z.infer<typeof QuizQuestionTypeSchema>;
export const DEFAULT_QUIZ_QUESTION_TYPES: QuizQuestionType[] = [
  "multiple_choice",
  "true_false",
  "short_answer",
];
export const QuizQuestionTypesSchema = z
  .array(QuizQuestionTypeSchema)
  .min(1)
  .max(DEFAULT_QUIZ_QUESTION_TYPES.length)
  .refine((types) => new Set(types).size === types.length, {
    message: "Question types must be unique",
  });

export const MasteryStateSchema = z.enum([
  "not_started",
  "basic",
  "intermediate",
  "expert",
  "mastered",
]);
export type MasteryState = z.infer<typeof MasteryStateSchema>;

export function masteryStateForScore(
  score: number,
): Exclude<MasteryState, "not_started"> {
  if (score >= 100) return "mastered";
  if (score >= 90) return "expert";
  if (score >= 80) return "intermediate";
  return "basic";
}

export const GenerationStageSchema = z.enum([
  "getting_video",
  "planning_questions",
  "creating_questions",
  "reviewing_questions",
  "repairing_questions",
  "finalizing_questions",
  "complete",
  "failed",
]);
export type GenerationStage = z.infer<typeof GenerationStageSchema>;

export const TranscriptSegmentSchema = z
  .object({
    id: z.string().min(1).max(80),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z
      .string()
      .min(1)
      .max(2_000)
      .refine((text) => text.trim().length > 0, {
        message: "Transcript text must contain visible content",
      }),
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: "endMs must be greater than startMs",
  });
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const MAX_COMPLETE_TRANSCRIPT_SEGMENTS = 60_000;
export const MAX_COMPLETE_TRANSCRIPT_CHARACTERS = 750_000;

export const TranscriptCompletenessSchema = z.object({
  status: z.literal("complete"),
  truncated: z.literal(false),
  sourceSegmentCount: z.number().int().positive(),
  segmentCount: z
    .number()
    .int()
    .positive()
    .max(MAX_COMPLETE_TRANSCRIPT_SEGMENTS),
  characterCount: z
    .number()
    .int()
    .positive()
    .max(MAX_COMPLETE_TRANSCRIPT_CHARACTERS),
  textFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  firstStartMs: z.number().int().nonnegative(),
  lastEndMs: z.number().int().positive(),
  expectedDurationMs: z.number().int().nonnegative(),
});
export type TranscriptCompleteness = z.infer<
  typeof TranscriptCompletenessSchema
>;

function canonicalTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function transcriptTextFingerprint(
  segments: TranscriptSegment[],
): string {
  const text = canonicalTranscriptText(segments);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createTranscriptCompleteness(
  segments: TranscriptSegment[],
  expectedDurationSeconds: number,
  sourceSegmentCount = segments.length,
): TranscriptCompleteness {
  const first = segments.at(0);
  const last = segments.at(-1);
  if (!first || !last)
    throw new Error("A complete transcript cannot be empty.");
  return TranscriptCompletenessSchema.parse({
    status: "complete",
    truncated: false,
    sourceSegmentCount,
    segmentCount: segments.length,
    characterCount: canonicalTranscriptText(segments).length,
    textFingerprint: transcriptTextFingerprint(segments),
    firstStartMs: first.startMs,
    lastEndMs: last.endMs,
    expectedDurationMs: Math.max(
      0,
      Math.round(expectedDurationSeconds * 1_000),
    ),
  });
}

export function transcriptCompletenessMatches(
  completeness: TranscriptCompleteness,
  segments: TranscriptSegment[],
  expectedDurationSeconds: number,
): boolean {
  if (segments.length === 0) return false;
  const calculated = createTranscriptCompleteness(
    segments,
    expectedDurationSeconds,
    completeness.sourceSegmentCount,
  );
  return (
    completeness.status === calculated.status &&
    completeness.truncated === calculated.truncated &&
    completeness.segmentCount === calculated.segmentCount &&
    completeness.characterCount === calculated.characterCount &&
    completeness.textFingerprint === calculated.textFingerprint &&
    completeness.firstStartMs === calculated.firstStartMs &&
    completeness.lastEndMs === calculated.lastEndMs &&
    completeness.expectedDurationMs === calculated.expectedDurationMs
  );
}

export function compactTranscriptSegments(
  input: TranscriptSegment[],
): TranscriptSegment[] {
  const source = input.map((segment) => TranscriptSegmentSchema.parse(segment));
  if (source.length <= MAX_COMPLETE_TRANSCRIPT_SEGMENTS) {
    return source.map((segment) => ({ ...segment }));
  }
  const output: TranscriptSegment[] = [];
  for (const segment of source) {
    const previous = output.at(-1);
    const combinedText = previous ? `${previous.text} ${segment.text}` : "";
    if (
      previous &&
      combinedText.length <= 1_800 &&
      segment.startMs - previous.startMs <= 30_000
    ) {
      previous.text = combinedText;
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      continue;
    }
    output.push({ ...segment });
  }
  if (output.length > MAX_COMPLETE_TRANSCRIPT_SEGMENTS) {
    throw new Error(
      "The complete transcript contains too many segments to upload safely.",
    );
  }
  if (transcriptTextFingerprint(source) !== transcriptTextFingerprint(output)) {
    throw new Error("Transcript compaction changed the subtitle text.");
  }
  return output;
}

export const CaptionTrackSchema = z.object({
  language: z.string().min(2).max(35),
  label: z.string().min(1).max(80),
  isAutoGenerated: z.boolean(),
});
export type CaptionTrack = z.infer<typeof CaptionTrackSchema>;

const httpUrl = z
  .string()
  .url()
  .max(2_048)
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    {
      message: "Only HTTP(S) YouTube links are supported",
    },
  );

export const VideoImportRequestSchema = z.object({
  url: httpUrl,
});
export type VideoImportRequest = z.infer<typeof VideoImportRequestSchema>;

export const CaptionSourceCategorySchema = z.enum([
  "manual",
  "automatic",
  "unknown",
]);
export type CaptionSourceCategory = z.infer<typeof CaptionSourceCategorySchema>;

export const VerifiedVideoMetadataRequestSchema = z
  .object({
    durationSeconds: z.number().int().min(1).max(86_400),
    sourceLanguage: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u),
    captionSourceCategory: CaptionSourceCategorySchema,
    captionSegmentCount: z.number().int().min(1).max(100_000),
    captionWordCount: z.number().int().min(1).max(5_000_000),
  })
  .strict();
export type VerifiedVideoMetadataRequest = z.infer<
  typeof VerifiedVideoMetadataRequestSchema
>;

export const VerifiedVideoMetadataResponseSchema = z
  .object({
    videoId: z.string().uuid(),
    verified: z.literal(true),
  })
  .strict();
export type VerifiedVideoMetadataResponse = z.infer<
  typeof VerifiedVideoMetadataResponseSchema
>;

export const VideoImportResponseSchema = z
  .object({
    video: z.object({
      id: z.string(),
      source: SourceSchema,
      sourceVideoId: z.string(),
      title: z.string(),
      thumbnailUrl: z.string().url(),
      durationSeconds: z.number().int().nonnegative(),
      sourceLanguage: z.string().nullable(),
    }),
    captions: z.object({
      available: z.boolean(),
      tracks: z.array(CaptionTrackSchema),
      preferredSegments: z.array(TranscriptSegmentSchema).optional(),
      preferredCompleteness: TranscriptCompletenessSchema.optional(),
      browserSourceAvailable: z.boolean().optional(),
      browserLookupAvailable: z.boolean().optional(),
    }),
    capture: z.object({
      expectedDurationSeconds: z.number().int().nonnegative(),
      requiresUserGesture: z.boolean(),
    }),
  })
  .superRefine((value, context) => {
    const segments = value.captions.preferredSegments;
    const completeness = value.captions.preferredCompleteness;
    if (Boolean(segments?.length) !== Boolean(completeness)) {
      context.addIssue({
        code: "custom",
        path: ["captions", "preferredCompleteness"],
        message:
          "Preferred captions and their complete-transcript manifest must be provided together.",
      });
      return;
    }
    if (
      segments?.length &&
      completeness &&
      !transcriptCompletenessMatches(
        completeness,
        segments,
        value.video.durationSeconds,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["captions", "preferredCompleteness"],
        message:
          "Preferred captions did not match their completeness manifest.",
      });
    }
  });
export type VideoImportResponse = z.infer<typeof VideoImportResponseSchema>;

export const CaptionResolveResponseSchema = z.object({
  captionUrl: z.string().url(),
  format: z.literal("json3"),
  language: z.string().min(2).max(35),
});
export type CaptionResolveResponse = z.infer<
  typeof CaptionResolveResponseSchema
>;

export const LOCAL_QUIZ_PROTOCOL_VERSION = 1 as const;
export const LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 5 as const;
export const STABLE_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 6 as const;
export const AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 7 as const;
export const GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 8 as const;
export const CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 9 as const;
export const LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 10 as const;
export const LOCAL_QUIZ_PIPELINE_VERSION = 9 as const;
export const LOCAL_QUIZ_MODEL = "deepseek-v4-flash" as const;
export const LocalQuizPromptVersionSchema = z.enum([
  "quiz-local-json-stream-v5.0",
  "quiz-local-json-stream-v5.1",
  "quiz-local-json-stream-v5.2",
  "quiz-local-json-stream-v5.3",
  "quiz-local-json-stream-v5.4",
  "quiz-local-json-stream-v5.5",
  "quiz-local-json-stream-v5.6",
  "quiz-local-json-stream-v5.7",
  "quiz-local-json-stream-v5.8",
  "quiz-local-json-stream-v5.9",
  "quiz-local-json-stream-v5.10",
  "quiz-local-json-stream-v5.11",
  "quiz-local-json-stream-v5.12",
]);
export type LocalQuizPromptVersion = z.infer<
  typeof LocalQuizPromptVersionSchema
>;
export const LOCAL_QUIZ_PROMPT_VERSION =
  "quiz-local-json-stream-v5.12" as const;
export const LocalQuizValidatorVersionSchema = z.enum([
  "validator-local-progressive-v4.0",
  "validator-local-progressive-v4.1",
  "validator-local-progressive-v4.2",
  "validator-local-progressive-v4.3",
  "validator-local-progressive-v4.4",
  "validator-local-progressive-v4.5",
  "validator-local-progressive-v4.6",
  "validator-local-progressive-v4.7",
  "validator-local-progressive-v4.8",
  "validator-local-progressive-v4.9",
  "validator-local-progressive-v4.10",
  "validator-local-progressive-v4.11",
  "validator-local-progressive-v4.12",
  "validator-minimal-structural-v5.0",
  "validator-minimal-gradeability-v5.1",
  "validator-minimal-gradeability-v5.2",
  "validator-minimal-gradeability-v5.3",
]);
export type LocalQuizValidatorVersion = z.infer<
  typeof LocalQuizValidatorVersionSchema
>;
export const LOCAL_QUIZ_VALIDATOR_VERSION =
  "validator-minimal-gradeability-v5.3" as const;
export const LocalQuizProgressiveImportVersionSchema = z.enum([
  "extension-progressive-import-v3",
  "extension-progressive-import-v4",
  "extension-progressive-import-v5",
  "extension-progressive-import-v6",
  "extension-progressive-import-v7",
  "extension-progressive-import-v8",
]);
export type LocalQuizProgressiveImportVersion = z.infer<
  typeof LocalQuizProgressiveImportVersionSchema
>;
export const LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION =
  "extension-progressive-import-v8" as const;
export const LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v1" as const;
export const LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v7" as const;
export const LOCAL_CHEAT_SHEET_CAPABILITY = "cheat-sheet-v1" as const;
export const LOCAL_ANSWER_GRADING_CAPABILITY = "answer-grading-v1" as const;

export const LocalAnswerGradeRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  response: z.string().trim().min(1).max(2_000),
  questionType: QuizQuestionTypeSchema,
  options: z.array(z.string().trim().min(1).max(500)).max(4).optional(),
  referenceAnswer: z.string().trim().min(1).max(1_000).optional(),
  requiredIdeas: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
  acceptableAlternatives: z
    .array(z.string().trim().min(1).max(1_000))
    .max(12)
    .optional(),
  correction: z.string().trim().min(1).max(1_000).optional(),
});
export type LocalAnswerGradeRequest = z.infer<
  typeof LocalAnswerGradeRequestSchema
>;

export const LocalAnswerGradeSchema = z.object({
  correct: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().trim().min(1).max(1_000),
  matchedIdeas: z.array(z.string().trim().min(1).max(240)).max(6),
  source: z.literal("deepseek_local"),
});
export type LocalAnswerGrade = z.infer<typeof LocalAnswerGradeSchema>;
export const CONCEPT_FIRST_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v6" as const;
export const GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v5" as const;
export const GROUNDED_V4_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v4" as const;
export const AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v3" as const;
export const STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v2" as const;

export const LocalQuizResultProtocolVersionSchema = z.union([
  z.literal(LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
  z.literal(STABLE_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
  z.literal(AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
  z.literal(GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
  z.literal(CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
  z.literal(LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
]);
export type LocalQuizResultProtocolVersion = z.infer<
  typeof LocalQuizResultProtocolVersionSchema
>;

export const GenerationFailureCodeSchema = z.enum([
  "transient_http",
  "network_interrupted",
  "timeout",
  "empty_content",
  "truncated_json",
  "finish_length",
  "schema_invalid",
  "type_or_order_mismatch",
  "choice_structure_invalid",
  "polarity_mismatch",
  "formula_structure_invalid",
  "duplicate_question",
  "answer_mapping_invalid",
  "credential_required",
  "billing_required",
  "local_state_conflict",
  "append_conflict",
  "source_unavailable",
  "recovery_budget_exhausted",
  "source_framing_invalid",
  "course_logistics_invalid",
  "low_pedagogical_value",
  "rubric_invalid",
  "non_instructional_source",
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
  "question_tautology_invalid",
  "question_answer_kind_mismatch",
  "answer_fragment_invalid",
  "unsupported_absolute_claim",
  "quiz_language_mismatch",
  "source_grounding_invalid",
  "retry_question_invalid",
  "true_false_compound_claim",
  "call_dispatch_timeout",
  "stream_idle_timeout",
]);
export const LocalGenerationFailureCodeSchema = GenerationFailureCodeSchema;
export type GenerationFailureCode = z.infer<typeof GenerationFailureCodeSchema>;
export type LocalGenerationFailureCode = z.infer<
  typeof LocalGenerationFailureCodeSchema
>;

export const MinimalGenerationFailureCodeSchema = z.enum([
  "transient_http",
  "network_interrupted",
  "timeout",
  "empty_content",
  "truncated_json",
  "schema_invalid",
  "type_or_order_mismatch",
  "choice_structure_invalid",
  "polarity_mismatch",
  "formula_structure_invalid",
  "append_conflict",
  "credential_required",
  "billing_required",
  "recovery_budget_exhausted",
  "source_unavailable",
  "local_state_conflict",
]);
export type MinimalGenerationFailureCode = z.infer<
  typeof MinimalGenerationFailureCodeSchema
>;

export const GenerationAvailabilityReasonCodeSchema = z.union([
  GenerationFailureCodeSchema,
  z.enum([
    "action_required",
    "automatic_retries_exhausted",
    "credential_invalid",
    "credential_missing",
    "generation_stalled",
    "cost_limit_reached",
  ]),
]);
export type GenerationAvailabilityReasonCode = z.infer<
  typeof GenerationAvailabilityReasonCodeSchema
>;

const PlannedQuestionCountSchema = QuestionCountSchema;

export const LocalQuestionPlanSchema = z
  .object({
    seed: z.string().regex(/^[a-f0-9]{64}$/),
    types: z.array(QuizQuestionTypeSchema).min(1).max(QUESTION_COUNT_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.types.length < 1 || value.types.length > QUESTION_COUNT_MAX) {
      context.addIssue({
        code: "custom",
        path: ["types"],
        message: "A question plan must contain no more than 50 slots.",
      });
    }
    const distinctTypes = new Set(value.types).size;
    for (let index = 2; index < value.types.length; index += 1) {
      if (
        distinctTypes > 1 &&
        value.types[index] === value.types[index - 1] &&
        value.types[index] === value.types[index - 2]
      ) {
        context.addIssue({
          code: "custom",
          path: ["types", index],
          message: "A question plan may not repeat one type more than twice.",
        });
      }
    }
  });
export type LocalQuestionPlan = z.infer<typeof LocalQuestionPlanSchema>;

export const LocalGenerationProfileSchema = z.enum([
  "legacy_reasoning_v5_1",
  "stable_non_thinking_v5_2",
  "stable_auto_recovery_v5_3",
  "evidence_grounded_auto_v5_4",
  "concept_first_auto_v5_8",
  "prompt_first_auto_v5_9",
  "prompt_first_auto_v5_10",
  "prompt_first_auto_v5_11",
  "prompt_first_auto_v5_12",
]);
export type LocalGenerationProfile = z.infer<
  typeof LocalGenerationProfileSchema
>;

export const LocalGenerationClientSchema = z
  .object({
    kind: z.enum(["chrome_extension", "android_app", "ios_app"]),
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(32),
    capability: z.literal(LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY),
  })
  .strict();
export type LocalGenerationClient = z.infer<typeof LocalGenerationClientSchema>;

export const QuizGenerationRolloutModeSchema = z.enum([
  "disabled",
  "canary",
  "enabled",
]);
export type QuizGenerationRolloutMode = z.infer<
  typeof QuizGenerationRolloutModeSchema
>;

export const QuizGenerationProfileResponseSchema = z
  .object({
    generationProfile: LocalGenerationProfileSchema,
    minimumExtensionVersion: z.enum([
      "0.8.0",
      "0.8.2",
      "0.8.3",
      "0.8.4",
      "0.8.5",
      "0.8.6",
      "0.8.7",
      "0.8.8",
      "0.8.9",
      "0.8.10",
      "0.8.12",
      "0.8.13",
      "0.8.14",
      "0.8.15",
      "0.8.16",
      "0.8.17",
      "0.8.26",
      "0.8.30",
      "0.8.31",
    ]),
    requiredCapability: z.enum([
      LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      GROUNDED_V4_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      CONCEPT_FIRST_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
    ]),
    clientRequirements: z
      .object({
        chromeExtension: z
          .object({
            minimumVersion: z.string().trim().min(1).max(32),
            requiredCapability: z.string().trim().min(1).max(64),
          })
          .strict(),
        androidApp: z
          .object({
            minimumVersion: z.literal("0.2.0"),
            requiredCapability: z.literal(
              LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
            ),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected: [readonly string[], string] =
      value.generationProfile === "prompt_first_auto_v5_12"
        ? [["0.8.26"], LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY]
        : value.generationProfile === "prompt_first_auto_v5_11"
          ? [["0.8.16"], LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY]
          : value.generationProfile === "prompt_first_auto_v5_10"
            ? [["0.8.15"], LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY]
            : value.generationProfile === "prompt_first_auto_v5_9"
              ? [["0.8.14"], LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY]
              : value.generationProfile === "concept_first_auto_v5_8"
                ? [
                    ["0.8.13"],
                    CONCEPT_FIRST_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
                  ]
                : value.generationProfile === "evidence_grounded_auto_v5_4"
                  ? [
                      ["0.8.7"],
                      GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
                    ]
                  : value.generationProfile === "stable_auto_recovery_v5_3"
                    ? [
                        ["0.8.3"],
                        AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
                      ]
                    : value.generationProfile === "stable_non_thinking_v5_2"
                      ? [
                          // 0.8.31 restored progressive delivery without
                          // changing the v2 wire capability. Accept the last
                          // compatible server requirement during a rolling
                          // deployment so native clients are never blocked by
                          // harmless extension patch-version skew.
                          ["0.8.30", "0.8.31"],
                          STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
                        ]
                      : [
                          ["0.8.0"],
                          LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
                        ];
    if (
      !expected[0].includes(value.minimumExtensionVersion) ||
      value.requiredCapability !== expected[1]
    ) {
      context.addIssue({
        code: "custom",
        path: ["generationProfile"],
        message:
          "The rollout profile must use its matching extension contract.",
      });
    }
  });
export type QuizGenerationProfileResponse = z.infer<
  typeof QuizGenerationProfileResponseSchema
>;

export const LocalAcceptedQuestionSummarySchema = z
  .object({
    id: z.string().regex(/^q(?:[1-9]|[1-4][0-9]|50)$/),
    type: z.enum(["multiple_choice", "true_false", "short_answer"]),
    concept: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(700),
    claimKey: z.string().trim().min(1).max(300).optional(),
    conceptCluster: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type LocalAcceptedQuestionSummary = z.infer<
  typeof LocalAcceptedQuestionSummarySchema
>;

export const LocalGenerationCallClassificationSchema = z.enum([
  "primary",
  "automatic_retry",
  "manual_continuation",
]);
export type LocalGenerationCallClassification = z.infer<
  typeof LocalGenerationCallClassificationSchema
>;

export const AutomaticRetryKindSchema = z.enum([
  "transport",
  "structural",
  "empty_content",
  "truncated_output",
  "content_repair",
  "duplicate_repair",
  "answer_repair",
  "automatic_resume",
]);
export type AutomaticRetryKind = z.infer<typeof AutomaticRetryKindSchema>;

export const GenerationRecoveryPhaseSchema = z.enum([
  "preparing",
  "dispatched",
  "streaming",
  "repairing",
  "cooldown",
  "complete",
  "failed",
]);
export type GenerationRecoveryPhase = z.infer<
  typeof GenerationRecoveryPhaseSchema
>;

export const LocalGenerationCallLifecycleSchema = z.enum([
  "started",
  "completed",
  "abandoned",
]);
export type LocalGenerationCallLifecycle = z.infer<
  typeof LocalGenerationCallLifecycleSchema
>;

export const LocalGenerationCallOutcomeSchema = z.union([
  z.enum(["complete", "partial_accepted"]),
  LocalGenerationFailureCodeSchema,
]);
export type LocalGenerationCallOutcome = z.infer<
  typeof LocalGenerationCallOutcomeSchema
>;

export const LegacyLocalGenerationCallEventSchema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    generationSessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(127),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    requestedCount: z.number().int().min(1).max(3),
    acceptedCount: z.number().int().min(0).max(3),
    classification: LocalGenerationCallClassificationSchema,
    outcome: LocalGenerationCallOutcomeSchema,
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedCount > value.requestedCount) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "A call cannot accept more questions than it requested.",
      });
    }
    if (value.startIndex + value.requestedCount > QUESTION_COUNT_MAX) {
      context.addIssue({
        code: "custom",
        path: ["requestedCount"],
        message: "A call cannot request positions beyond q50.",
      });
    }
    if (
      value.outcome === "complete" &&
      value.acceptedCount !== value.requestedCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "A complete call must accept every requested question.",
      });
    }
    if (
      value.outcome === "partial_accepted" &&
      (value.acceptedCount < 1 || value.acceptedCount === value.requestedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "A partial call must accept a non-empty strict subset.",
      });
    }
    const usageFields = [
      value.inputTokens,
      value.outputTokens,
      value.reasoningTokens,
    ];
    if (
      value.usageComplete &&
      usageFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageComplete"],
        message: "Complete usage requires all token counters.",
      });
    }
  });

export const LegacyAutomaticRecoveryCallEventSchema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    protocolVersion: z.literal(LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    purpose: z.literal("automatic_recovery"),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(127),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    ordinalAttempt: z.number().int().min(1).max(24),
    requestedCount: z.literal(1),
    acceptedCount: z.union([z.literal(0), z.literal(1)]),
    classification: z.enum(["primary", "automatic_retry"]),
    retryKind: AutomaticRetryKindSchema.optional(),
    outcome: LocalGenerationCallOutcomeSchema,
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.classification === "automatic_retry") !==
      (value.retryKind !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only automatic retries require a retry kind.",
      });
    }
    if (
      (value.outcome === "complete" && value.acceptedCount !== 1) ||
      value.outcome === "partial_accepted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Legacy automatic recovery uses singleton calls.",
      });
    }
    const usageFields = [
      value.inputTokens,
      value.outputTokens,
      value.reasoningTokens,
    ];
    if (
      value.usageComplete &&
      usageFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageComplete"],
        message: "Complete usage requires all token counters.",
      });
    }
  });
export type LegacyAutomaticRecoveryCallEvent = z.infer<
  typeof LegacyAutomaticRecoveryCallEventSchema
>;
export const LocalGenerationCallEventV3Schema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    protocolVersion: z.literal(AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(127),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    ordinalAttempt: z.number().int().min(1).max(12),
    requestedCount: z.literal(1),
    acceptedCount: z.union([z.literal(0), z.literal(1)]),
    classification: z.enum(["primary", "automatic_retry"]),
    retryKind: AutomaticRetryKindSchema.optional(),
    outcome: LocalGenerationCallOutcomeSchema,
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.classification === "automatic_retry") !==
      (value.retryKind !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only automatic retries require a retry kind.",
      });
    }
    if (
      (value.outcome === "complete" && value.acceptedCount !== 1) ||
      value.outcome === "partial_accepted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Singleton calls are either complete or failed.",
      });
    }
    const usageFields = [
      value.inputTokens,
      value.outputTokens,
      value.reasoningTokens,
    ];
    if (
      value.usageComplete &&
      usageFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageComplete"],
        message: "Complete usage requires all token counters.",
      });
    }
  });
export type LocalGenerationCallEventV3 = z.infer<
  typeof LocalGenerationCallEventV3Schema
>;

export const LocalGenerationCallEventV4Schema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    protocolVersion: z.literal(GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    purpose: z.literal("generation"),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(127),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    ordinalAttempt: z.number().int().min(1).max(24),
    requestedCount: z.literal(1),
    acceptedCount: z.union([z.literal(0), z.literal(1)]),
    classification: z.enum(["primary", "automatic_retry"]),
    retryKind: AutomaticRetryKindSchema.optional(),
    outcome: LocalGenerationCallOutcomeSchema,
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.classification === "automatic_retry") !==
      (value.retryKind !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only automatic retries require a retry kind.",
      });
    }
    if (
      (value.outcome === "complete" && value.acceptedCount !== 1) ||
      value.outcome === "partial_accepted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Grounded singleton calls are either complete or failed.",
      });
    }
    const usageFields = [
      value.inputTokens,
      value.outputTokens,
      value.reasoningTokens,
    ];
    if (
      value.usageComplete &&
      usageFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageComplete"],
        message: "Complete usage requires all token counters.",
      });
    }
  });
export type LocalGenerationCallEventV4 = z.infer<
  typeof LocalGenerationCallEventV4Schema
>;

export const LocalGenerationCallEventV5Schema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    protocolVersion: z.literal(
      CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION,
    ),
    purpose: z.literal("generation"),
    lifecycleState: LocalGenerationCallLifecycleSchema,
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(255),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    ordinalAttempt: z.number().int().min(1).max(24),
    requestedCount: z.literal(1),
    acceptedCount: z.union([z.literal(0), z.literal(1)]).default(0),
    classification: z.enum(["primary", "automatic_retry"]),
    retryKind: AutomaticRetryKindSchema.optional(),
    outcome: LocalGenerationCallOutcomeSchema.optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000).optional(),
    lastStreamActivityElapsedMs: z
      .number()
      .int()
      .min(0)
      .max(900_000)
      .optional(),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.classification === "automatic_retry") !==
      (value.retryKind !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only automatic retries require a retry kind.",
      });
    }
    if (value.lifecycleState === "started") {
      if (
        value.outcome !== undefined ||
        value.elapsedMs !== undefined ||
        value.acceptedCount !== 0 ||
        value.usageComplete ||
        value.inputTokens !== undefined ||
        value.outputTokens !== undefined ||
        value.reasoningTokens !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["lifecycleState"],
          message: "A started call cannot contain terminal result data.",
        });
      }
      return;
    }
    if (!value.outcome || value.elapsedMs === undefined) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "A terminal call lifecycle requires an outcome and elapsed time.",
      });
    }
    if (
      value.lifecycleState === "completed" &&
      value.outcome === "complete" &&
      value.acceptedCount !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "A completed successful singleton call accepts one question.",
      });
    }
    if (value.outcome === "partial_accepted") {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Concept-first calls are strict singletons.",
      });
    }
    const usageFields = [
      value.inputTokens,
      value.outputTokens,
      value.reasoningTokens,
    ];
    if (
      value.usageComplete &&
      usageFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageComplete"],
        message: "Complete usage requires all token counters.",
      });
    }
  });
export type LocalGenerationCallEventV5 = z.infer<
  typeof LocalGenerationCallEventV5Schema
>;

export const LocalGenerationCallEventV6Schema = z
  .object({
    client: LocalGenerationClientSchema.optional(),
    protocolVersion: z.literal(LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    purpose: z.literal("generation"),
    lifecycleState: LocalGenerationCallLifecycleSchema,
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    callIndex: z.number().int().min(0).max(255),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    ordinalAttempt: z.number().int().min(1).max(24),
    requestedCount: z.literal(1),
    acceptedCount: z.union([z.literal(0), z.literal(1)]).default(0),
    classification: z.enum(["primary", "automatic_retry"]),
    // V10 emits the truthful repair class for every validator outcome. This
    // includes transport, structural, content, answer, duplicate, and resume
    // retries; narrowing the union makes a valid repair lifecycle abort the
    // learner's generation while serializing telemetry.
    retryKind: AutomaticRetryKindSchema.optional(),
    // Protocol 10 reports the exact validator outcome so the local client
    // can choose the matching repair attempt. Keep the full failure-code
    // contract here; narrowing this to transport/structural codes causes a
    // valid AI quality rejection (for example unsupported_absolute_claim)
    // to throw while serializing telemetry and abort the quiz.
    outcome: z
      .union([z.literal("complete"), LocalGenerationFailureCodeSchema])
      .optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).default(0),
    elapsedMs: z.number().int().min(0).max(900_000).optional(),
    lastStreamActivityElapsedMs: z
      .number()
      .int()
      .min(0)
      .max(900_000)
      .optional(),
    inputTokens: z.number().int().min(0).max(20_000_000).optional(),
    outputTokens: z.number().int().min(0).max(2_000_000).optional(),
    reasoningTokens: z.number().int().min(0).max(2_000_000).optional(),
    usageComplete: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.classification === "automatic_retry") !==
      (value.retryKind !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only automatic retries require a retry kind.",
      });
    }
    if (value.lifecycleState === "started") {
      if (
        value.outcome !== undefined ||
        value.elapsedMs !== undefined ||
        value.acceptedCount !== 0 ||
        value.usageComplete ||
        value.inputTokens !== undefined ||
        value.outputTokens !== undefined ||
        value.reasoningTokens !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["lifecycleState"],
          message: "A started call cannot contain terminal result data.",
        });
      }
      return;
    }
    if (!value.outcome || value.elapsedMs === undefined) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "A terminal call requires an outcome and elapsed time.",
      });
    }
    if (value.outcome === "complete" && value.acceptedCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "A successful singleton call accepts one question.",
      });
    }
  });
export type LocalGenerationCallEventV6 = z.infer<
  typeof LocalGenerationCallEventV6Schema
>;

export const LocalGenerationCallEventSchema = z.union([
  LegacyAutomaticRecoveryCallEventSchema,
  LegacyLocalGenerationCallEventSchema,
  LocalGenerationCallEventV3Schema,
  LocalGenerationCallEventV4Schema,
  LocalGenerationCallEventV5Schema,
  LocalGenerationCallEventV6Schema,
]);
export type LocalGenerationCallEvent = z.infer<
  typeof LocalGenerationCallEventSchema
>;

const RetryOrdinalsSchema = z
  .array(z.number().int().min(1).max(QUESTION_COUNT_MAX))
  .max(QUESTION_COUNT_MAX)
  .superRefine((value, context) => {
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0 && value[index]! <= value[index - 1]!) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Retry ordinals must be unique and strictly increasing.",
        });
      }
    }
  });

export const GenerationRecordV2Schema = z
  .object({
    version: z.literal(2),
    generationId: z.string().uuid(),
    generationSessionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    ownerUserId: z.string().min(1).max(200),
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    questionTypes: QuizQuestionTypesSchema,
    sessionLength: SessionLengthSchema,
    watched: z.boolean(),
    questionPlan: LocalQuestionPlanSchema.optional(),
    generationProfile: LocalGenerationProfileSchema.optional(),
    quizId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    acceptedCount: z.number().int().min(0).max(QUESTION_COUNT_MAX),
    plannedCount: PlannedQuestionCountSchema,
    state: z.enum([
      "pending",
      "generating",
      "retrying",
      "retry_required",
      "ready",
    ]),
    nextCallIndex: z.number().int().min(0).max(128),
    preworkStatus: z
      .enum(["running", "ready", "unavailable", "failed"])
      .optional(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedCount > value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "Accepted questions cannot exceed the planned total.",
      });
    }
    if (
      (value.state === "ready") !==
      (value.acceptedCount === value.plannedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Only a fully accepted generation record may be ready.",
      });
    }
    if (
      value.questionPlan &&
      value.questionPlan.types.length !== value.plannedCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["questionPlan", "types"],
        message: "The saved question plan must match the planned total.",
      });
    }
  });
export type GenerationRecordV2 = z.infer<typeof GenerationRecordV2Schema>;

export const GenerationRecordV3Schema = z
  .object({
    version: z.literal(3),
    generationId: z.string().uuid(),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    ownerUserId: z.string().min(1).max(200),
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    questionTypes: QuizQuestionTypesSchema,
    sessionLength: SessionLengthSchema,
    watched: z.boolean(),
    questionPlan: LocalQuestionPlanSchema,
    generationProfile: z.literal("stable_auto_recovery_v5_3"),
    quizId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    acceptedCount: z.number().int().min(0).max(QUESTION_COUNT_MAX),
    plannedCount: PlannedQuestionCountSchema,
    state: z.enum([
      "pending",
      "generating",
      "retrying",
      "recovering",
      "action_required",
      "generation_failed",
      "ready",
    ]),
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
    retryOrdinal: z.number().int().min(1).max(QUESTION_COUNT_MAX).optional(),
    ordinalAttempt: z.number().int().min(1).max(24).optional(),
    retryKind: AutomaticRetryKindSchema.optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).optional(),
    nextCallIndex: z.number().int().min(0).max(128),
    ordinalAttempts: z
      .record(
        z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/),
        z.number().int().min(0).max(12),
      )
      .default({}),
    automaticRetryCount: z.number().int().min(0).max(12).default(0),
    activeRecoveryStartedAt: z.number().int().positive().optional(),
    sourceReadyAt: z.number().int().positive().optional(),
    preworkStatus: z
      .enum(["running", "ready", "unavailable", "failed"])
      .optional(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedCount > value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "Accepted questions cannot exceed the planned total.",
      });
    }
    if (
      (value.state === "ready") !==
      (value.acceptedCount === value.plannedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Only a fully accepted generation record may be ready.",
      });
    }
    if (value.questionPlan.types.length !== value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["questionPlan", "types"],
        message: "The saved question plan must match the planned total.",
      });
    }
    if (
      value.reasonCode &&
      value.state !== "action_required" &&
      value.state !== "generation_failed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only terminal recovery states may contain a reason code.",
      });
    }
    if (
      (value.state === "action_required" ||
        value.state === "generation_failed") &&
      !value.reasonCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Terminal recovery states require a bounded reason code.",
      });
    }
    const hasRetryMetadata =
      value.retryOrdinal !== undefined ||
      value.ordinalAttempt !== undefined ||
      value.retryKind !== undefined ||
      value.retryDelayMs !== undefined;
    if (
      value.state === "retrying" &&
      (!value.retryOrdinal || !value.ordinalAttempt || !value.retryKind)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Retrying availability requires bounded retry metadata.",
      });
    }
    if (value.state !== "retrying" && hasRetryMetadata) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only retrying records may contain retry metadata.",
      });
    }
  });
export type GenerationRecordV3 = z.infer<typeof GenerationRecordV3Schema>;

export const GenerationRecordV4Schema = z
  .object({
    version: z.literal(4),
    generationId: z.string().uuid(),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    ownerUserId: z.string().min(1).max(200),
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    questionTypes: QuizQuestionTypesSchema,
    sessionLength: SessionLengthSchema,
    watched: z.boolean(),
    questionPlan: LocalQuestionPlanSchema,
    generationProfile: z.enum([
      "evidence_grounded_auto_v5_4",
      "concept_first_auto_v5_8",
      "prompt_first_auto_v5_9",
      "prompt_first_auto_v5_10",
      "prompt_first_auto_v5_11",
      "prompt_first_auto_v5_12",
    ]),
    quizId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    acceptedCount: z.number().int().min(0).max(QUESTION_COUNT_MAX),
    plannedCount: PlannedQuestionCountSchema,
    state: z.enum([
      "pending",
      "generating",
      "retrying",
      "recovering",
      "cooldown",
      "action_required",
      "generation_failed",
      "ready",
    ]),
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
    retryOrdinal: z.number().int().min(1).max(QUESTION_COUNT_MAX).optional(),
    ordinalAttempt: z.number().int().min(1).max(24).optional(),
    retryKind: AutomaticRetryKindSchema.optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).optional(),
    nextRecoveryAt: z.number().int().positive().optional(),
    recoveryPhase: GenerationRecoveryPhaseSchema.optional(),
    activeCallIndex: z.number().int().min(0).max(255).optional(),
    recoveryCycle: z.number().int().min(0).max(24).default(0),
    nextCallIndex: z.number().int().min(0).max(256),
    ordinalAttempts: z
      .record(
        z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/),
        z.number().int().min(0).max(24),
      )
      .default({}),
    automaticRetryCount: z.number().int().min(0).max(48).default(0),
    activeRecoveryStartedAt: z.number().int().positive().optional(),
    sourceReadyAt: z.number().int().positive().optional(),
    preworkStatus: z
      .enum(["running", "ready", "unavailable", "failed"])
      .optional(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedCount > value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCount"],
        message: "Accepted questions cannot exceed the planned total.",
      });
    }
    if (
      (value.state === "ready") !==
      (value.acceptedCount === value.plannedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Only a fully accepted generation record may be ready.",
      });
    }
    if (value.questionPlan.types.length !== value.plannedCount) {
      context.addIssue({
        code: "custom",
        path: ["questionPlan", "types"],
        message: "The saved question plan must match the planned total.",
      });
    }
    if (
      value.state === "action_required" ||
      value.state === "generation_failed"
    ) {
      if (!value.reasonCode) {
        context.addIssue({
          code: "custom",
          path: ["reasonCode"],
          message: "Stopped recovery states require a bounded reason code.",
        });
      }
    } else if (value.reasonCode && value.state !== "cooldown") {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only cooldown or stopped states may contain a reason code.",
      });
    }
    if ((value.state === "cooldown") !== (value.nextRecoveryAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["nextRecoveryAt"],
        message: "Cooldown records require exactly one recovery time.",
      });
    }
    const hasRetryMetadata =
      value.retryOrdinal !== undefined ||
      value.ordinalAttempt !== undefined ||
      value.retryKind !== undefined ||
      value.retryDelayMs !== undefined;
    if (
      value.state === "retrying" &&
      (!value.retryOrdinal || !value.ordinalAttempt || !value.retryKind)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Retrying records require bounded ordinal metadata.",
      });
    }
    if (value.state !== "retrying" && hasRetryMetadata) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Only retrying records may contain retry metadata.",
      });
    }
  });
export type GenerationRecordV4 = z.infer<typeof GenerationRecordV4Schema>;
export const GenerationRecordSchema = z.union([
  GenerationRecordV2Schema,
  GenerationRecordV3Schema,
  GenerationRecordV4Schema,
]);
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

export const GenerationClaimRequestSchema = z
  .object({
    claimKey: z.string().uuid(),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid().optional(),
  })
  .strict();
export type GenerationClaimRequest = z.infer<
  typeof GenerationClaimRequestSchema
>;

export const GenerationClaimSchema = z
  .object({
    state: z.enum(["not_required", "available", "leased"]),
    leaseExpiresAt: z.string().datetime().nullable(),
    recoverySessionId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type GenerationClaim = z.infer<typeof GenerationClaimSchema>;

export const GenerationClaimHeartbeatRequestSchema = z
  .object({
    claimKey: z.string().uuid(),
    generationSessionId: z.string().uuid(),
    recoverySessionId: z.string().uuid(),
  })
  .strict();
export type GenerationClaimHeartbeatRequest = z.infer<
  typeof GenerationClaimHeartbeatRequestSchema
>;

export const LocalQuizContextSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_PROTOCOL_VERSION),
    jobId: z.string().uuid(),
    generationId: z.string().uuid().optional(),
    generationSessionId: z.string().uuid().optional(),
    recoverySessionId: z.string().uuid().optional(),
    generationProfile: LocalGenerationProfileSchema.optional(),
    videoId: z.string().uuid(),
    title: z.string().min(1).max(500),
    quizLanguage: LanguageSchema,
    questionTypes: QuizQuestionTypesSchema,
    questionCount: QuestionCountSchema,
    transcriptFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
    transcriptLanguage: z.string().min(2).max(35),
    segments: z
      .array(TranscriptSegmentSchema)
      .min(1)
      .max(MAX_COMPLETE_TRANSCRIPT_SEGMENTS),
    continuation: z
      .object({
        startIndex: z
          .number()
          .int()
          .min(1)
          .max(QUESTION_COUNT_MAX - 1),
        resultProtocolVersion: LocalQuizResultProtocolVersionSchema.optional(),
        promptVersion: LocalQuizPromptVersionSchema.optional(),
        validatorVersion: LocalQuizValidatorVersionSchema.optional(),
        promptFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        generationProfile: LocalGenerationProfileSchema.optional(),
        client: LocalGenerationClientSchema.optional(),
        questionPlan: LocalQuestionPlanSchema.optional(),
        claim: GenerationClaimSchema.optional(),
        nextCallIndex: z.number().int().min(0).max(256).optional(),
        nextOrdinalAttempt: z.number().int().min(1).max(24).optional(),
        retryKind: AutomaticRetryKindSchema.optional(),
        automaticRetryCount: z.number().int().min(0).max(48).optional(),
        retryBudgetUsedCount: z.number().int().min(0).max(48).optional(),
        automaticRecoveryCount: z.number().int().min(0).max(24).optional(),
        retryOrdinals: RetryOrdinalsSchema.optional(),
        previousOutcome: LocalGenerationCallOutcomeSchema.optional(),
        acceptedQuestions: z
          .array(LocalAcceptedQuestionSummarySchema)
          .min(1)
          .max(QUESTION_COUNT_MAX - 1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.generationProfile === "stable_non_thinking_v5_2" ||
        value.generationProfile === "stable_auto_recovery_v5_3" ||
        value.generationProfile === "evidence_grounded_auto_v5_4" ||
        value.generationProfile === "concept_first_auto_v5_8" ||
        value.generationProfile === "prompt_first_auto_v5_9" ||
        value.generationProfile === "prompt_first_auto_v5_10" ||
        value.generationProfile === "prompt_first_auto_v5_11" ||
        value.generationProfile === "prompt_first_auto_v5_12") &&
      (!value.generationId || !value.generationSessionId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["generationId"],
        message: "Stable generation requires generation and session IDs.",
      });
    }
    if (!value.continuation) return;
    if (
      value.generationProfile &&
      value.continuation.generationProfile &&
      value.generationProfile !== value.continuation.generationProfile
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "generationProfile"],
        message: "Continuation must preserve the original generation profile.",
      });
    }
    if (
      value.continuation.startIndex >= value.questionCount ||
      value.continuation.acceptedQuestions.length !==
        value.continuation.startIndex
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "Continuation must begin at the first missing question.",
      });
      return;
    }
    if (
      value.continuation.retryOrdinals?.some(
        (ordinal) => ordinal <= value.continuation!.startIndex,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "retryOrdinals"],
        message: "Retry ordinals must belong to the missing suffix.",
      });
    }
    const typePlan =
      value.continuation.questionPlan?.types ??
      questionTypePlanForSelection(value.questionTypes, value.questionCount);
    if (
      value.continuation.questionPlan &&
      !questionPlanMatchesSelection(
        value.continuation.questionPlan,
        value.questionTypes,
        value.questionCount,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "questionPlan"],
        message:
          "Continuation question plans must match the original selection.",
      });
    }
    value.continuation.acceptedQuestions.forEach((question, index) => {
      if (
        question.id !== `q${index + 1}` ||
        question.type !== typePlan[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["continuation", "acceptedQuestions", index],
          message: "Accepted question summaries must match the global plan.",
        });
      }
    });
  });
export type LocalQuizContext = z.infer<typeof LocalQuizContextSchema>;

const LocalQuestionBaseSchema = z
  .object({
    id: z.string().regex(/^q(?:[1-9]|[1-4][0-9]|50)$/),
    concept: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(700),
    retryQuestion: z.string().trim().min(1).max(700).optional(),
    explanation: z.string().trim().min(1).max(1_500),
    claimKey: z.string().trim().min(1).max(300).optional(),
    conceptCluster: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const LocalMultipleChoiceQuestionSchema = LocalQuestionBaseSchema.extend(
  {
    type: z.literal("multiple_choice"),
    choices: z.tuple([
      z.string().trim().min(1).max(500),
      z.string().trim().min(1).max(500),
      z.string().trim().min(1).max(500),
      z.string().trim().min(1).max(500),
    ]),
    answerIndex: z.number().int().min(0).max(3),
    answer: z.string().trim().min(1).max(500),
  },
)
  .strict()
  .superRefine((question, context) => {
    const normalizedChoices = question.choices.map((choice) =>
      choice.trim().toLocaleLowerCase(),
    );
    if (new Set(normalizedChoices).size !== 4) {
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "All four choices must be distinct.",
      });
    }
    if (question.answer !== question.choices[question.answerIndex]) {
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "The answer must exactly match the indexed choice.",
      });
    }
  });

export const LocalTrueFalseQuestionSchema = LocalQuestionBaseSchema.extend({
  type: z.literal("true_false"),
  answer: z.boolean(),
  correction: z.string().trim().min(1).max(700),
}).strict();

export const LocalShortAnswerModeSchema = z.enum([
  "atomic_term",
  "proposition",
  "enumeration",
  "formula",
]);
export type LocalShortAnswerMode = z.infer<typeof LocalShortAnswerModeSchema>;

export const PromptFirstGradingModeSchema = LocalShortAnswerModeSchema;

const PromptFirstBaseQuestionSchema = z
  .object({
    type: QuizQuestionTypeSchema,
    concept: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(700),
    explanation: z.string().trim().min(1).max(1_500),
  })
  .strict();

export const PromptFirstMultipleChoiceSchema =
  PromptFirstBaseQuestionSchema.extend({
    type: z.literal("multiple_choice"),
    correctAnswer: z.string().trim().min(1).max(500),
    distractors: z.tuple([
      z.string().trim().min(1).max(500),
      z.string().trim().min(1).max(500),
      z.string().trim().min(1).max(500),
    ]),
  }).strict();

export const PromptFirstTrueFalseSchema = PromptFirstBaseQuestionSchema.extend({
  type: z.literal("true_false"),
  answer: z.boolean(),
  correction: z.string().trim().min(1).max(700),
}).strict();

export const PromptFirstShortAnswerSchema =
  PromptFirstBaseQuestionSchema.extend({
    type: z.literal("short_answer"),
    answer: z.string().trim().min(1).max(1_000),
    gradingMode: PromptFirstGradingModeSchema,
    acceptableAnswers: z
      .array(z.string().trim().min(1).max(1_000))
      .max(8)
      .default([]),
    requiredItems: z
      .array(z.string().trim().min(1).max(300))
      .max(8)
      .default([]),
    formulaTokens: z
      .array(
        z.object({
          kind: z.enum([
            "identifier",
            "number",
            "operator",
            "left_paren",
            "right_paren",
            "comma",
            "prime",
          ]),
          value: z.string().trim().min(1).max(24),
        }),
      )
      .min(1)
      .max(96)
      .optional(),
  }).strict();

export const PromptFirstQuestionSchema = z.discriminatedUnion("type", [
  PromptFirstMultipleChoiceSchema,
  PromptFirstTrueFalseSchema,
  PromptFirstShortAnswerSchema,
]);

const LocalAtomicShortAnswerRubricV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.literal("atomic_term"),
    canonicalAnswer: z.string().trim().min(1).max(500),
    aliases: z.array(z.string().trim().min(1).max(500)).max(8),
  })
  .strict();

const LocalPropositionShortAnswerRubricV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.literal("proposition"),
    requiredIdeas: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
    acceptableAnswers: z.array(z.string().trim().min(1).max(1_000)).max(8),
  })
  .strict();

const LocalEnumerationShortAnswerRubricV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.literal("enumeration"),
    requiredItems: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    requiredCardinality: z.number().int().min(2).max(8),
    aliasesByItem: z
      .array(z.array(z.string().trim().min(1).max(300)).max(6))
      .min(2)
      .max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.requiredItems.length !== value.requiredCardinality ||
      value.aliasesByItem.length !== value.requiredItems.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredCardinality"],
        message:
          "Enumeration cardinality and alias groups must match the required items.",
      });
    }
  });

const LocalFormulaShortAnswerRubricV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.literal("formula"),
    canonicalFormula: z.string().trim().min(1).max(1_000),
    acceptableFormulas: z.array(z.string().trim().min(1).max(1_000)).max(8),
  })
  .strict();

export const LocalShortAnswerRubricV2Schema = z.discriminatedUnion("mode", [
  LocalAtomicShortAnswerRubricV2Schema,
  LocalPropositionShortAnswerRubricV2Schema,
  LocalEnumerationShortAnswerRubricV2Schema,
  LocalFormulaShortAnswerRubricV2Schema,
]);
export type LocalShortAnswerRubricV2 = z.infer<
  typeof LocalShortAnswerRubricV2Schema
>;

export const LocalShortAnswerQuestionSchema = LocalQuestionBaseSchema.extend({
  type: z.literal("short_answer"),
  answer: z.string().trim().min(1).max(1_000),
  rubricIdeas: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  acceptableAnswers: z.array(z.string().trim().min(1).max(1_000)).max(8),
  shortAnswerMode: LocalShortAnswerModeSchema.optional(),
  rubricV2: LocalShortAnswerRubricV2Schema.optional(),
})
  .strict()
  .superRefine((value, context) => {
    if (
      (value.shortAnswerMode === undefined) !==
      (value.rubricV2 === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rubricV2"],
        message: "Versioned short-answer mode and rubric must appear together.",
      });
    }
    if (value.rubricV2 && value.shortAnswerMode !== value.rubricV2.mode) {
      context.addIssue({
        code: "custom",
        path: ["shortAnswerMode"],
        message: "The short-answer mode must match its versioned rubric.",
      });
    }
  });

export const LocalConceptQuizQuestionSchema = z.discriminatedUnion("type", [
  LocalMultipleChoiceQuestionSchema,
  LocalTrueFalseQuestionSchema,
  LocalShortAnswerQuestionSchema,
]);
export type LocalConceptQuizQuestion = z.infer<
  typeof LocalConceptQuizQuestionSchema
>;

export const LocalConceptQuizSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    questions: z
      .array(LocalConceptQuizQuestionSchema)
      .min(QUESTION_COUNT_MIN)
      .max(QUESTION_COUNT_MAX),
  })
  .strict()
  .superRefine((quiz, context) => {
    if (
      quiz.questions.length < QUESTION_COUNT_MIN ||
      quiz.questions.length > QUESTION_COUNT_MAX
    ) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "A local quiz must contain between 5 and 50 questions.",
      });
    }
    quiz.questions.forEach((question, index) => {
      if (question.id !== `q${index + 1}`) {
        context.addIssue({
          code: "custom",
          path: ["questions", index, "id"],
          message: "Question IDs must be ordered from q1 onward.",
        });
      }
    });
  });
export type LocalConceptQuiz = z.infer<typeof LocalConceptQuizSchema>;

export const LocalSourceSelectionMetricsSchema = z
  .object({
    sentenceCount: z.number().int().min(1).max(100_000),
    excludedSentenceCount: z.number().int().min(0).max(100_000),
    candidateWindowCount: z.number().int().min(1).max(10_000),
    selectedWindowCount: z.number().int().min(1).max(100),
    focusWordCount: z.number().int().min(1).max(20_000),
  })
  .strict();
export type LocalSourceSelectionMetrics = z.infer<
  typeof LocalSourceSelectionMetricsSchema
>;

function localQuizMetricsSchema(minimumAiCalls: 0 | 1) {
  return z
    .object({
      aiCalls: z.number().int().min(minimumAiCalls).max(96),
      retryCount: z.number().int().min(0).max(48),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      reasoningTokens: z.number().int().nonnegative(),
      elapsedMs: z.number().int().positive(),
      sourceSelection: LocalSourceSelectionMetricsSchema.optional(),
    })
    .strict();
}

const LocalQuizMetricsSchema = localQuizMetricsSchema(1);
const LocalQuizChunkMetricsSchema = localQuizMetricsSchema(0);

type LocalGenerationMetadata = {
  protocolVersion: 5 | 6 | 7 | 8 | 9 | 10;
  reasoningEffort: "high" | "none";
  promptVersion: LocalQuizPromptVersion;
  validatorVersion: LocalQuizValidatorVersion;
  importVersion?: LocalQuizProgressiveImportVersion;
  generationProfile?: LocalGenerationProfile;
  generationId?: string;
  generationSessionId?: string;
  recoverySessionId?: string;
  questionPlan?: LocalQuestionPlan;
  promptFingerprint?: string;
};

function validateLocalGenerationMetadata(
  value: LocalGenerationMetadata,
  context: z.RefinementCtx,
): void {
  const promptFirstV512 =
    value.promptVersion === "quiz-local-json-stream-v5.12";
  const promptFirstV511 =
    value.promptVersion === "quiz-local-json-stream-v5.11";
  const promptFirstV510 =
    value.promptVersion === "quiz-local-json-stream-v5.10";
  const promptFirstV59 = value.promptVersion === "quiz-local-json-stream-v5.9";
  const conceptFirstV58 = value.promptVersion === "quiz-local-json-stream-v5.8";
  const groundedV57 = value.promptVersion === "quiz-local-json-stream-v5.7";
  const groundedV56 = value.promptVersion === "quiz-local-json-stream-v5.6";
  const groundedV55 = value.promptVersion === "quiz-local-json-stream-v5.5";
  const groundedV54 = value.promptVersion === "quiz-local-json-stream-v5.4";
  const grounded = groundedV57 || groundedV56 || groundedV55 || groundedV54;
  const automatic = value.promptVersion === "quiz-local-json-stream-v5.3";
  const stable = value.promptVersion === "quiz-local-json-stream-v5.2";
  const valid = promptFirstV512
    ? value.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
      value.reasoningEffort === "none" &&
      value.validatorVersion === LOCAL_QUIZ_VALIDATOR_VERSION &&
      value.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION &&
      value.generationProfile === "prompt_first_auto_v5_12" &&
      Boolean(value.generationId) &&
      Boolean(value.generationSessionId) &&
      Boolean(value.recoverySessionId) &&
      Boolean(value.questionPlan) &&
      Boolean(value.promptFingerprint?.match(/^[a-f0-9]{64}$/))
    : promptFirstV511
      ? value.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
        value.reasoningEffort === "none" &&
        value.validatorVersion === "validator-minimal-gradeability-v5.2" &&
        value.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION &&
        value.generationProfile === "prompt_first_auto_v5_11" &&
        Boolean(value.generationId) &&
        Boolean(value.generationSessionId) &&
        Boolean(value.recoverySessionId) &&
        Boolean(value.questionPlan) &&
        Boolean(value.promptFingerprint?.match(/^[a-f0-9]{64}$/))
      : promptFirstV510
        ? value.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
          value.reasoningEffort === "none" &&
          value.validatorVersion === "validator-minimal-gradeability-v5.1" &&
          value.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION &&
          value.generationProfile === "prompt_first_auto_v5_10" &&
          Boolean(value.generationId) &&
          Boolean(value.generationSessionId) &&
          Boolean(value.recoverySessionId) &&
          Boolean(value.questionPlan) &&
          Boolean(value.promptFingerprint?.match(/^[a-f0-9]{64}$/))
        : promptFirstV59
          ? value.protocolVersion === LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
            value.reasoningEffort === "none" &&
            value.validatorVersion === "validator-minimal-structural-v5.0" &&
            value.importVersion === LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION &&
            value.generationProfile === "prompt_first_auto_v5_9" &&
            Boolean(value.generationId) &&
            Boolean(value.generationSessionId) &&
            Boolean(value.recoverySessionId) &&
            Boolean(value.questionPlan) &&
            Boolean(value.promptFingerprint?.match(/^[a-f0-9]{64}$/))
          : conceptFirstV58
            ? value.protocolVersion ===
                CONCEPT_FIRST_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
              value.reasoningEffort === "none" &&
              value.validatorVersion === "validator-local-progressive-v4.12" &&
              value.importVersion === "extension-progressive-import-v7" &&
              value.generationProfile === "concept_first_auto_v5_8" &&
              Boolean(value.generationId) &&
              Boolean(value.generationSessionId) &&
              Boolean(value.recoverySessionId) &&
              Boolean(value.questionPlan) &&
              Boolean(value.promptFingerprint?.match(/^[a-f0-9]{64}$/))
            : grounded
              ? value.protocolVersion ===
                  GROUNDED_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
                value.reasoningEffort === "none" &&
                value.validatorVersion ===
                  (groundedV57
                    ? "validator-local-progressive-v4.6"
                    : groundedV56
                      ? "validator-local-progressive-v4.5"
                      : groundedV55
                        ? "validator-local-progressive-v4.4"
                        : "validator-local-progressive-v4.3") &&
                value.importVersion === "extension-progressive-import-v6" &&
                value.generationProfile === "evidence_grounded_auto_v5_4" &&
                Boolean(value.generationId) &&
                Boolean(value.generationSessionId) &&
                Boolean(value.recoverySessionId) &&
                Boolean(value.questionPlan)
              : automatic
                ? value.protocolVersion ===
                    AUTOMATIC_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
                  value.reasoningEffort === "none" &&
                  value.validatorVersion ===
                    "validator-local-progressive-v4.2" &&
                  value.importVersion === "extension-progressive-import-v5" &&
                  value.generationProfile === "stable_auto_recovery_v5_3" &&
                  Boolean(value.generationId) &&
                  Boolean(value.generationSessionId) &&
                  Boolean(value.recoverySessionId) &&
                  Boolean(value.questionPlan)
                : stable
                  ? value.protocolVersion ===
                      STABLE_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
                    value.reasoningEffort === "none" &&
                    value.validatorVersion ===
                      "validator-local-progressive-v4.1" &&
                    value.importVersion === "extension-progressive-import-v4" &&
                    value.generationProfile === "stable_non_thinking_v5_2" &&
                    Boolean(value.generationId) &&
                    Boolean(value.questionPlan)
                  : value.protocolVersion ===
                      LEGACY_LOCAL_QUIZ_RESULT_PROTOCOL_VERSION &&
                    value.reasoningEffort === "high" &&
                    value.validatorVersion ===
                      "validator-local-progressive-v4.0" &&
                    (value.importVersion === undefined ||
                      value.importVersion ===
                        "extension-progressive-import-v3") &&
                    (value.generationProfile === undefined ||
                      value.generationProfile === "legacy_reasoning_v5_1") &&
                    value.questionPlan === undefined;
  if (!valid) {
    context.addIssue({
      code: "custom",
      path: ["promptVersion"],
      message:
        "Generation protocol, prompt, validator, and profile metadata must match.",
    });
  }
}

export const LocalConceptQuizResultSchema = z
  .object({
    protocolVersion: LocalQuizResultProtocolVersionSchema,
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.enum(["high", "none"]),
    promptVersion: LocalQuizPromptVersionSchema,
    validatorVersion: LocalQuizValidatorVersionSchema,
    importVersion: LocalQuizProgressiveImportVersionSchema.optional(),
    generationProfile: LocalGenerationProfileSchema.optional(),
    client: LocalGenerationClientSchema.optional(),
    generationId: z.string().uuid().optional(),
    generationSessionId: z.string().uuid().optional(),
    recoverySessionId: z.string().uuid().optional(),
    questionPlan: LocalQuestionPlanSchema.optional(),
    promptFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    quiz: LocalConceptQuizSchema,
    metrics: LocalQuizMetricsSchema,
  })
  .strict()
  .superRefine((value, context) =>
    validateLocalGenerationMetadata(value, context),
  );
export type LocalConceptQuizResult = z.infer<
  typeof LocalConceptQuizResultSchema
>;

export const LocalConceptQuizContinuationResultSchema = z
  .object({
    protocolVersion: LocalQuizResultProtocolVersionSchema,
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.enum(["high", "none"]),
    promptVersion: LocalQuizPromptVersionSchema,
    validatorVersion: LocalQuizValidatorVersionSchema,
    importVersion: LocalQuizProgressiveImportVersionSchema.optional(),
    generationProfile: LocalGenerationProfileSchema.optional(),
    client: LocalGenerationClientSchema.optional(),
    generationId: z.string().uuid().optional(),
    generationSessionId: z.string().uuid().optional(),
    recoverySessionId: z.string().uuid().optional(),
    questionPlan: LocalQuestionPlanSchema.optional(),
    promptFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    title: z.string().trim().min(1).max(300),
    generatedStartIndex: z
      .number()
      .int()
      .min(1)
      .max(QUESTION_COUNT_MAX - 1),
    totalQuestions: QuestionCountSchema,
    metrics: LocalQuizMetricsSchema,
  })
  .strict()
  .superRefine((value, context) =>
    validateLocalGenerationMetadata(value, context),
  );
export const LocalConceptQuizGenerationResultSchema = z.union([
  LocalConceptQuizResultSchema,
  LocalConceptQuizContinuationResultSchema,
]);
export type LocalConceptQuizGenerationResult = z.infer<
  typeof LocalConceptQuizGenerationResultSchema
>;

export const LocalConceptQuizQuestionChunkSchema = z
  .object({
    protocolVersion: LocalQuizResultProtocolVersionSchema,
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.enum(["high", "none"]),
    promptVersion: LocalQuizPromptVersionSchema,
    validatorVersion: LocalQuizValidatorVersionSchema,
    importVersion: LocalQuizProgressiveImportVersionSchema.optional(),
    generationProfile: LocalGenerationProfileSchema.optional(),
    client: LocalGenerationClientSchema.optional(),
    generationId: z.string().uuid().optional(),
    generationSessionId: z.string().uuid().optional(),
    recoverySessionId: z.string().uuid().optional(),
    questionPlan: LocalQuestionPlanSchema.optional(),
    promptFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    title: z.string().trim().min(1).max(300),
    startIndex: z
      .number()
      .int()
      .min(0)
      .max(QUESTION_COUNT_MAX - 1),
    totalQuestions: QuestionCountSchema,
    question: LocalConceptQuizQuestionSchema,
    metrics: LocalQuizChunkMetricsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateLocalGenerationMetadata(value, context);
    const { startIndex, totalQuestions, question } = value;
    if (startIndex >= totalQuestions) {
      context.addIssue({
        code: "custom",
        path: ["startIndex"],
        message: "A streamed question must begin at a valid quiz position.",
      });
    }
    if (question.id !== `q${startIndex + 1}`) {
      context.addIssue({
        code: "custom",
        path: ["question", "id"],
        message: "The question ID must match its global quiz position.",
      });
    }
    if (
      value.questionPlan &&
      value.questionPlan.types.length !== value.totalQuestions
    ) {
      context.addIssue({
        code: "custom",
        path: ["questionPlan", "types"],
        message: "The question plan must match the streamed quiz total.",
      });
    }
  });
export type LocalConceptQuizQuestionChunk = z.infer<
  typeof LocalConceptQuizQuestionChunkSchema
>;

// Temporary source-compatible aliases for app modules migrating from the
// rolled-back protocol-4 prototype. Both aliases validate protocol 5 only.
export const LocalConceptQuizChunkSchema = LocalConceptQuizQuestionChunkSchema;
export type LocalConceptQuizChunk = LocalConceptQuizQuestionChunk;

export const ExtensionQuizProgressiveImportRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    sessionLength: SessionLengthSchema,
    questionCount: QuestionCountSchema.optional(),
    questionTypes: QuizQuestionTypesSchema,
    watched: z.boolean(),
    chunk: LocalConceptQuizQuestionChunkSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sessionLength === "custom" && value.questionCount === undefined) {
      context.addIssue({
        code: "custom",
        path: ["questionCount"],
        message: "A custom session length requires a question count.",
      });
      return;
    }
    const expectedCount = questionLimitForSession(
      value.sessionLength,
      value.questionCount,
    );
    if (value.chunk.totalQuestions !== expectedCount) {
      context.addIssue({
        code: "custom",
        path: ["chunk", "totalQuestions"],
        message: "The planned quiz count must match the session length.",
      });
    }
    const expectedTypes =
      value.chunk.questionPlan?.types ??
      questionTypePlanForSelection(value.questionTypes, expectedCount);
    if (
      value.chunk.questionPlan &&
      !questionPlanMatchesSelection(
        value.chunk.questionPlan,
        value.questionTypes,
        expectedCount,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["chunk", "questionPlan"],
        message:
          "The streamed type plan must match the selected question types.",
      });
    }
    if (value.chunk.question.type !== expectedTypes[value.chunk.startIndex]) {
      context.addIssue({
        code: "custom",
        path: ["chunk", "question", "type"],
        message: "The streamed question type must match the requested plan.",
      });
    }
  });
export type ExtensionQuizProgressiveImportRequest = z.infer<
  typeof ExtensionQuizProgressiveImportRequestSchema
>;

export const ExtensionQuizChunkAppendRequestSchema = z
  .object({ chunk: LocalConceptQuizQuestionChunkSchema })
  .strict();
export type ExtensionQuizChunkAppendRequest = z.infer<
  typeof ExtensionQuizChunkAppendRequestSchema
>;

export const ExtensionQuizGenerationCallEventRequestSchema =
  LocalGenerationCallEventSchema;
export type ExtensionQuizGenerationCallEventRequest = z.infer<
  typeof ExtensionQuizGenerationCallEventRequestSchema
>;

export const ExtensionQuizGenerationCallEventResponseSchema = z
  .object({
    quizId: z.string().uuid(),
    recorded: z.literal(true),
  })
  .strict();
export type ExtensionQuizGenerationCallEventResponse = z.infer<
  typeof ExtensionQuizGenerationCallEventResponseSchema
>;

export const AttemptGenerationAvailabilitySchema = z
  .object({
    state: z.enum([
      "generating",
      "retrying",
      "recovering",
      "cooldown",
      "retry_required",
      "action_required",
      "generation_failed",
      "ready",
    ]),
    availableQuestions: z.number().int().min(1).max(QUESTION_COUNT_MAX),
    totalQuestions: QuestionCountSchema,
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
    retryOrdinal: z.number().int().min(1).max(QUESTION_COUNT_MAX).optional(),
    ordinalAttempt: z.number().int().min(1).max(24).optional(),
    retryKind: AutomaticRetryKindSchema.optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).optional(),
    recoverySessionId: z.string().uuid().optional(),
    nextRecoveryAt: z.string().datetime().optional(),
    recoveryPhase: GenerationRecoveryPhaseSchema.optional(),
    activeCallIndex: z.number().int().min(0).max(255).optional(),
    // The API sets this only when a stopped generation can actually be
    // reclaimed.  Keeping it optional preserves compatibility with import
    // progress events produced by older local clients.
    retryAvailable: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availableQuestions > value.totalQuestions) {
      context.addIssue({
        code: "custom",
        path: ["availableQuestions"],
        message: "Available questions cannot exceed the planned total.",
      });
    }
    if (
      (value.state === "ready") !==
      (value.availableQuestions === value.totalQuestions)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Only a fully stored quiz may be marked ready.",
      });
    }
    if (
      value.reasonCode &&
      value.state !== "retry_required" &&
      value.state !== "cooldown" &&
      value.state !== "action_required" &&
      value.state !== "generation_failed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only a stopped generation state may include a reason code.",
      });
    }
    if ((value.state === "cooldown") !== (value.nextRecoveryAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["nextRecoveryAt"],
        message: "Cooldown availability requires exactly one recovery time.",
      });
    }
    if (
      value.state === "retrying" &&
      (value.retryOrdinal !== undefined ||
        value.ordinalAttempt !== undefined ||
        value.retryKind !== undefined) &&
      (!value.retryOrdinal || !value.ordinalAttempt || !value.retryKind)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Retrying availability requires bounded retry metadata.",
      });
    }
  });
export type AttemptGenerationAvailability = z.infer<
  typeof AttemptGenerationAvailabilitySchema
>;

export const ExtensionQuizProgressiveImportResponseSchema = z
  .object({
    quizId: z.string().uuid(),
    generation: AttemptGenerationAvailabilitySchema,
  })
  .strict();
export type ExtensionQuizProgressiveImportResponse = z.infer<
  typeof ExtensionQuizProgressiveImportResponseSchema
>;

export const ExtensionQuizGenerationProgressRequestSchema = z
  .object({
    state: z.enum([
      "generating",
      "retrying",
      "recovering",
      "cooldown",
      "retry_required",
      "action_required",
      "generation_failed",
    ]),
    reasonCode: GenerationAvailabilityReasonCodeSchema.optional(),
    retryOrdinal: z.number().int().min(1).max(QUESTION_COUNT_MAX).optional(),
    ordinalAttempt: z.number().int().min(1).max(24).optional(),
    retryKind: AutomaticRetryKindSchema.optional(),
    retryDelayMs: z.number().int().min(0).max(300_000).optional(),
    recoverySessionId: z.string().uuid().optional(),
    nextRecoveryAt: z.string().datetime().optional(),
    recoveryPhase: GenerationRecoveryPhaseSchema.optional(),
    activeCallIndex: z.number().int().min(0).max(255).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.reasonCode &&
      value.state !== "retry_required" &&
      value.state !== "cooldown" &&
      value.state !== "action_required" &&
      value.state !== "generation_failed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only a stopped generation state may include a reason code.",
      });
    }
    if ((value.state === "cooldown") !== (value.nextRecoveryAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["nextRecoveryAt"],
        message: "Cooldown progress requires exactly one recovery time.",
      });
    }
    if (
      value.state === "retrying" &&
      (value.retryOrdinal !== undefined ||
        value.ordinalAttempt !== undefined ||
        value.retryKind !== undefined) &&
      (!value.retryOrdinal || !value.ordinalAttempt || !value.retryKind)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryKind"],
        message: "Automatic retries require bounded ordinal metadata.",
      });
    }
  });
export type ExtensionQuizGenerationProgressRequest = z.infer<
  typeof ExtensionQuizGenerationProgressRequestSchema
>;

export const AttemptGenerationResponseSchema = z
  .object({
    attemptId: z.string().uuid(),
    quizId: z.string().uuid(),
    generation: AttemptGenerationAvailabilitySchema,
    continuation: z
      .object({
        videoId: z.string().uuid(),
        quizLanguage: LanguageSchema,
        sessionLength: SessionLengthSchema,
        questionCount: QuestionCountSchema.optional(),
        questionTypes: QuizQuestionTypesSchema,
        watched: z.boolean(),
        startIndex: z
          .number()
          .int()
          .min(1)
          .max(QUESTION_COUNT_MAX - 1),
        resultProtocolVersion: LocalQuizResultProtocolVersionSchema,
        pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
        model: z.literal(LOCAL_QUIZ_MODEL),
        reasoningEffort: z.enum(["high", "none"]),
        promptVersion: LocalQuizPromptVersionSchema,
        validatorVersion: LocalQuizValidatorVersionSchema,
        promptFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        importVersion: LocalQuizProgressiveImportVersionSchema,
        generationProfile: LocalGenerationProfileSchema,
        client: LocalGenerationClientSchema.optional(),
        generationId: z.string().uuid().optional(),
        generationSessionId: z.string().uuid().optional(),
        recoverySessionId: z.string().uuid().optional(),
        nextCallIndex: z.number().int().min(0).max(256).optional(),
        nextOrdinalAttempt: z.number().int().min(1).max(24).optional(),
        retryKind: AutomaticRetryKindSchema.optional(),
        automaticRetryCount: z.number().int().min(0).max(48).optional(),
        retryBudgetUsedCount: z.number().int().min(0).max(48).optional(),
        automaticRecoveryCount: z.number().int().min(0).max(24).optional(),
        retryOrdinals: RetryOrdinalsSchema.optional(),
        previousOutcome: LocalGenerationCallOutcomeSchema.optional(),
        activeCall: z
          .object({
            lifecycleState: z.literal("started"),
            callIndex: z.number().int().min(0).max(255),
            startIndex: z
              .number()
              .int()
              .min(0)
              .max(QUESTION_COUNT_MAX - 1),
            ordinalAttempt: z.number().int().min(1).max(24),
          })
          .strict()
          .optional(),
        questionPlan: LocalQuestionPlanSchema.optional(),
        claim: GenerationClaimSchema,
        acceptedQuestions: z
          .array(LocalAcceptedQuestionSummarySchema)
          .min(1)
          .max(QUESTION_COUNT_MAX - 1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.continuation) return;
    if (
      value.continuation.sessionLength === "custom" &&
      value.continuation.questionCount === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "questionCount"],
        message: "A custom session length requires a question count.",
      });
      return;
    }
    if (
      value.generation.state === "ready" ||
      value.continuation.startIndex !== value.generation.availableQuestions ||
      value.continuation.acceptedQuestions.length !==
        value.continuation.startIndex ||
      questionLimitForSession(
        value.continuation.sessionLength,
        value.continuation.questionCount,
      ) !== value.generation.totalQuestions
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "Continuation must describe the authoritative missing suffix.",
      });
      return;
    }
    if (
      value.continuation.retryOrdinals?.some(
        (ordinal) => ordinal <= value.continuation!.startIndex,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "retryOrdinals"],
        message: "Retry ordinals must belong to the missing suffix.",
      });
    }
    if (
      value.continuation.activeCall &&
      (value.continuation.activeCall.startIndex !==
        value.continuation.startIndex ||
        value.continuation.nextCallIndex !==
          value.continuation.activeCall.callIndex + 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "activeCall"],
        message:
          "An active lifecycle must describe the authoritative missing ordinal and next call index.",
      });
    }
    const typePlan =
      value.continuation.questionPlan?.types ??
      questionTypePlanForSelection(
        value.continuation.questionTypes,
        value.generation.totalQuestions,
      );
    if (
      value.continuation.questionPlan &&
      !questionPlanMatchesSelection(
        value.continuation.questionPlan,
        value.continuation.questionTypes,
        value.generation.totalQuestions,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation", "questionPlan"],
        message: "Continuation metadata contains an invalid question plan.",
      });
    }
    value.continuation.acceptedQuestions.forEach((question, index) => {
      if (
        question.id !== `q${index + 1}` ||
        question.type !== typePlan[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["continuation", "acceptedQuestions", index],
          message: "Accepted summaries must match the global question plan.",
        });
      }
    });
  });
export type AttemptGenerationResponse = z.infer<
  typeof AttemptGenerationResponseSchema
>;

export const GenerationClaimResponseSchema = z
  .object({
    attemptId: z.string().uuid(),
    quizId: z.string().uuid(),
    generation: AttemptGenerationAvailabilitySchema,
    claim: GenerationClaimSchema,
  })
  .strict();
export type GenerationClaimResponse = z.infer<
  typeof GenerationClaimResponseSchema
>;

export const ExtensionQuizImportRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    sessionLength: SessionLengthSchema,
    questionCount: QuestionCountSchema.optional(),
    questionTypes: QuizQuestionTypesSchema,
    watched: z.boolean(),
    quiz: LocalConceptQuizResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sessionLength === "custom" && value.questionCount === undefined) {
      context.addIssue({
        code: "custom",
        path: ["questionCount"],
        message: "A custom session length requires a question count.",
      });
      return;
    }
    const expectedCount = questionLimitForSession(
      value.sessionLength,
      value.questionCount,
    );
    if (value.quiz.quiz.questions.length !== expectedCount) {
      context.addIssue({
        code: "custom",
        path: ["quiz", "quiz", "questions"],
        message: "The quiz count must match the requested session length.",
      });
    }
    const expectedTypes =
      value.quiz.questionPlan?.types ??
      questionTypePlanForSelection(value.questionTypes, expectedCount);
    if (
      value.quiz.questionPlan &&
      !questionPlanMatchesSelection(
        value.quiz.questionPlan,
        value.questionTypes,
        expectedCount,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["quiz", "questionPlan"],
        message:
          "The generated type plan must match the selected question types.",
      });
    }
    value.quiz.quiz.questions.forEach((question, index) => {
      if (question.type !== expectedTypes[index]) {
        context.addIssue({
          code: "custom",
          path: ["quiz", "quiz", "questions", index, "type"],
          message:
            "The generated question type must match the requested type plan.",
        });
      }
    });
  });
export type ExtensionQuizImportRequest = z.infer<
  typeof ExtensionQuizImportRequestSchema
>;

export const ExtensionQuizImportResponseSchema = z
  .object({ quizId: z.string().uuid() })
  .strict();
export type ExtensionQuizImportResponse = z.infer<
  typeof ExtensionQuizImportResponseSchema
>;

export const QuizStartRequestSchema = z
  .object({
    mode: z.enum(["learn", "review"]).default("learn"),
    sessionLength: SessionLengthSchema,
    questionCount: QuestionCountSchema.optional(),
    questionTypes: QuizQuestionTypesSchema.default(DEFAULT_QUIZ_QUESTION_TYPES),
    watched: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.sessionLength === "custom" && value.questionCount === undefined) {
      context.addIssue({
        code: "custom",
        path: ["questionCount"],
        message: "A custom session length requires a question count.",
      });
    }
  });
export type QuizStartRequest = z.infer<typeof QuizStartRequestSchema>;

export const PublicQuestionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["multiple_choice", "true_false", "ordering", "short_answer"]),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  difficulty: z.number().int().min(1).max(5),
  position: z.number().int().positive(),
  total: z.number().int().positive(),
  isRetry: z.boolean(),
});
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

export const QuizStartResponseSchema = z.object({
  attemptId: z.string().uuid(),
  primer: z.string().nullable(),
  question: PublicQuestionSchema,
  generation: AttemptGenerationAvailabilitySchema,
});
export type QuizStartResponse = z.infer<typeof QuizStartResponseSchema>;

export const AnswerValueSchema = z.union([
  z.number().int().nonnegative(),
  z.boolean(),
  z.array(z.number().int().nonnegative()),
  z.string().trim().min(1).max(2_000),
]);

export const AttemptAnswerRequestSchema = z.object({
  questionId: z.string().uuid(),
  answer: AnswerValueSchema,
});
export type AttemptAnswerRequest = z.infer<typeof AttemptAnswerRequestSchema>;

export const AttemptAnswerResponseSchema = z.object({
  correct: z.boolean(),
  correctAnswer: AnswerValueSchema.nullable(),
  explanation: z.string().min(1),
  evidenceSegmentIds: z.array(z.string()),
  nextQuestion: PublicQuestionSchema.nullable(),
  completed: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  mastery: MasteryStateSchema.nullable(),
  generation: AttemptGenerationAvailabilitySchema,
});
export type AttemptAnswerResponse = z.infer<typeof AttemptAnswerResponseSchema>;

export const AttemptResumeResponseSchema = z.object({
  attemptId: z.string().uuid(),
  quizId: z.string().uuid().optional(),
  videoId: z.string().uuid().optional(),
  title: z.string().optional(),
  question: PublicQuestionSchema.nullable(),
  completed: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  mastery: MasteryStateSchema.nullable(),
  generation: AttemptGenerationAvailabilitySchema,
});
export type AttemptResumeResponse = z.infer<typeof AttemptResumeResponseSchema>;

export const LibraryCardSchema = z.object({
  videoId: z.string().uuid(),
  sourceVideoId: z.string().min(1).max(128).optional(),
  quizId: z.string().uuid().nullable(),
  attemptId: z.string().uuid().nullable(),
  originalUrl: httpUrl,
  source: SourceSchema,
  title: z.string(),
  thumbnailUrl: z.string().url(),
  bestScore: z.number().min(0).max(100).nullable(),
  mastery: MasteryStateSchema,
  action: z.enum(["start", "continue", "review"]),
  dueForReview: z.boolean(),
  startSettings: z
    .object({
      sessionLength: SessionLengthSchema,
      questionTypes: QuizQuestionTypesSchema,
    })
    .nullable()
    .optional(),
  cheatSheet: z
    .object({
      status: z.enum(["ready", "failed", "none"]),
      sheetId: z.string().uuid().nullable(),
      updatedAt: z.number().int().nonnegative().nullable(),
    })
    .default({ status: "none", sheetId: null, updatedAt: null }),
});
export type LibraryCard = z.infer<typeof LibraryCardSchema>;

export const LibraryResponseSchema = z.object({
  dueReviews: z.array(LibraryCardSchema),
  saved: z.array(LibraryCardSchema),
  youtubeSuggestions: z.array(LibraryCardSchema),
});
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export const VideoDeleteResponseSchema = z.object({
  videoId: z.string().uuid(),
  deleted: z.literal(true),
});
export type VideoDeleteResponse = z.infer<typeof VideoDeleteResponseSchema>;

export const CheatSheetStatusSchema = z.enum(["ready", "failed", "none"]);
export type CheatSheetStatus = z.infer<typeof CheatSheetStatusSchema>;

export const CheatSheetContextSchema = z
  .object({
    videoId: z.string().uuid(),
    sourceVideoId: z.string().min(1).max(128),
    quizId: z.string().uuid().nullable(),
    sourceRevision: z.string().min(1).max(128),
    title: z.string().min(1).max(500),
    source: SourceSchema,
    language: LanguageSchema,
    primer: z.string().max(10_000),
    questions: z
      .array(
        z.object({
          prompt: z.string().min(1).max(2_000),
          explanation: z.string().min(1).max(4_000),
        }),
      )
      .max(100),
  })
  .strict();
export type CheatSheetContext = z.infer<typeof CheatSheetContextSchema>;

const CHEAT_SHEET_FORBIDDEN_WORDING =
  /\b(?:chemical|electrical)\s+(?:barricade|wall|shield)\b/iu;

export const CheatSheetDocumentSchema = z
  .object({
    title: z.string().min(1).max(240),
    source: z.string().min(1).max(500),
    summary: z.string().min(1).max(4_000),
    keyConcepts: z.array(z.string().min(1).max(500)).max(20),
    definitions: z
      .array(
        z.object({
          term: z.string().min(1).max(200),
          definition: z.string().min(1).max(1_000),
        }),
      )
      .max(30),
    formulas: z.array(z.string().min(1).max(500)).max(20),
    rememberThis: z.array(z.string().min(1).max(500)).max(10),
    generatedAt: z.string().datetime(),
    sourceRevision: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    const text = [
      value.title,
      value.source,
      value.summary,
      ...value.keyConcepts,
      ...value.definitions.flatMap((item) => [item.term, item.definition]),
      ...value.formulas,
      ...value.rememberThis,
    ].join("\n");
    if (CHEAT_SHEET_FORBIDDEN_WORDING.test(text)) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message:
          "Cheat sheets must use direct mechanism wording instead of chemical/electrical barricade, wall, or shield metaphors.",
      });
    }
  });
export type CheatSheetDocument = z.infer<typeof CheatSheetDocumentSchema>;

export const CheatSheetResponseSchema = z
  .object({
    id: z.string().uuid(),
    videoId: z.string().uuid(),
    quizId: z.string().uuid().nullable(),
    sourceRevision: z.string(),
    status: CheatSheetStatusSchema,
    document: CheatSheetDocumentSchema.nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type CheatSheetResponse = z.infer<typeof CheatSheetResponseSchema>;

export const CheatSheetUploadRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    quizId: z.string().uuid().nullable(),
    sourceRevision: z.string().min(1).max(128),
    document: CheatSheetDocumentSchema,
    // The embedded Unicode font makes otherwise small PDFs several megabytes.
    // Keep the encoded request bounded while allowing multilingual exports.
    pdfBase64: z.string().min(1).max(10_000_000),
    contentHash: z.string().min(1).max(128),
    promptVersion: z.string().min(1).max(64),
  })
  .strict();
export type CheatSheetUploadRequest = z.infer<
  typeof CheatSheetUploadRequestSchema
>;

export const CheatSheetFailureRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    quizId: z.string().uuid(),
    sourceRevision: z.string().min(1).max(128),
    promptVersion: z.string().min(1).max(64),
    lastError: z.string().min(1).max(500),
  })
  .strict();
export type CheatSheetFailureRequest = z.infer<
  typeof CheatSheetFailureRequestSchema
>;

export const ProfileAvatarResponseSchema = z
  .object({ image: z.string().nullable(), revision: z.string().nullable() })
  .strict();
export type ProfileAvatarResponse = z.infer<typeof ProfileAvatarResponseSchema>;

export const ProfileLearningStatsResponseSchema = z
  .object({
    completedLessons: z.number().int().nonnegative(),
    totalDurationSeconds: z.number().int().nonnegative(),
  })
  .strict();
export type ProfileLearningStatsResponse = z.infer<
  typeof ProfileLearningStatsResponseSchema
>;

export const LeaderboardEntrySchema = z
  .object({
    rank: z.number().int().positive(),
    name: z.string().min(1).max(120),
    completedQuizzes: z.number().int().nonnegative(),
  })
  .strict();
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export const LeaderboardResponseSchema = z
  .object({ entries: z.array(LeaderboardEntrySchema) })
  .strict();
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const PushRegisterRequestSchema = z.object({
  token: z.string().min(8).max(1_000),
  platform: z.enum(["ios", "android", "web"]),
  locale: LanguageSchema,
});
export const PushRegisterResponseSchema = z
  .object({ registered: z.literal(true) })
  .strict();
export const PushUnregisterRequestSchema = z
  .object({ token: z.string().min(8).max(1_000) })
  .strict();
export const PushUnregisterResponseSchema = z
  .object({ removed: z.boolean() })
  .strict();

export const YouTubeDeviceStartResponseSchema = z.object({
  flowId: z.string().uuid(),
  userCode: z.string().min(4),
  verificationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  intervalSeconds: z.number().int().positive(),
});

export const YouTubeDeviceStatusSchema = z.object({
  state: z.enum(["pending", "connected", "expired", "failed"]),
  importedCandidates: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Workplace: a synced chat surface backed by workplace_threads/
// workplace_messages. Every persisted schema below is `.strict()` so secret-
// shaped keys, raw caption arrays, full transcripts, note documents, and
// hidden answers can never slip into a stored payload -- only bounded,
// learner-visible fields and already-validated artifacts (like a complete
// LocalConceptQuizQuestionSchema) are accepted.
// ---------------------------------------------------------------------------

export const WorkplaceSuggestionKindSchema = z.enum([
  "recent",
  "unmastered",
  "due",
]);
export type WorkplaceSuggestionKind = z.infer<
  typeof WorkplaceSuggestionKindSchema
>;
export const WORKPLACE_SUGGESTION_KINDS: readonly WorkplaceSuggestionKind[] = [
  "recent",
  "unmastered",
  "due",
] as const;

export const WorkplaceSuggestionSchema = z
  .object({
    kind: WorkplaceSuggestionKindSchema,
    videoId: z.string().uuid(),
    quizId: z.string().uuid().nullable(),
    title: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type WorkplaceSuggestion = z.infer<typeof WorkplaceSuggestionSchema>;

export const WorkplaceSuggestionsResponseSchema = z
  .object({
    suggestions: z.array(WorkplaceSuggestionSchema).length(3),
  })
  .strict()
  .superRefine((value, context) => {
    const kinds = value.suggestions.map((suggestion) => suggestion.kind);
    if (new Set(kinds).size !== WORKPLACE_SUGGESTION_KINDS.length) {
      context.addIssue({
        code: "custom",
        path: ["suggestions"],
        message: "Suggestions must not repeat a kind.",
      });
      return;
    }
    for (const kind of WORKPLACE_SUGGESTION_KINDS) {
      if (!kinds.includes(kind)) {
        context.addIssue({
          code: "custom",
          path: ["suggestions"],
          message: `Suggestions must include a ${kind} recommendation.`,
        });
      }
    }
  });
export type WorkplaceSuggestionsResponse = z.infer<
  typeof WorkplaceSuggestionsResponseSchema
>;

const WORKPLACE_MESSAGE_TEXT_MAX_LENGTH = 4_000;
const WORKPLACE_CITATION_QUOTE_MAX_LENGTH = 320;

// A citation points at a bounded excerpt of an owned video, never at the raw
// caption array or full transcript backing it.
export const WorkplaceCitationSchema = z
  .object({
    videoId: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    quote: z.string().trim().min(1).max(WORKPLACE_CITATION_QUOTE_MAX_LENGTH),
  })
  .strict()
  .refine((citation) => citation.endMs > citation.startMs, {
    message: "endMs must be greater than startMs",
    path: ["endMs"],
  });
export type WorkplaceCitation = z.infer<typeof WorkplaceCitationSchema>;

export const WorkplaceToolNameSchema = z.enum([
  "search_videos",
  "search_transcript",
  "generate_practice_set",
  "lookup_mastery",
  "find_due_reviews",
]);
export type WorkplaceToolName = z.infer<typeof WorkplaceToolNameSchema>;

export const WorkplaceToolCallStatusSchema = z.enum([
  "requested",
  "running",
  "complete",
  "error",
]);
export type WorkplaceToolCallStatus = z.infer<
  typeof WorkplaceToolCallStatusSchema
>;

// Sanitized status embedded in a persisted message: a tool name, its status,
// a bounded learner-visible summary, and optional grounding citations. Raw
// tool arguments/output are intentionally never part of this shape.
export const WorkplaceToolStatusSchema = z
  .object({
    name: WorkplaceToolNameSchema,
    status: WorkplaceToolCallStatusSchema,
    summary: z.string().trim().min(1).max(300),
    citations: z.array(WorkplaceCitationSchema).max(5).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "error" && value.citations.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["citations"],
        message: "A failed tool call cannot carry grounding citations.",
      });
    }
  });
export type WorkplaceToolStatus = z.infer<typeof WorkplaceToolStatusSchema>;

export const WORKPLACE_PRACTICE_SET_QUESTION_COUNT = 5 as const;

export const WorkplacePracticePolicySchema = z.enum(["practice", "diagnostic"]);
export type WorkplacePracticePolicy = z.infer<
  typeof WorkplacePracticePolicySchema
>;

// A fully validated practice artifact the local AI may hand back to the
// Workplace thread: exactly five already-validated quiz questions, the
// requested vs. effective assessment policy, a learner-visible rationale for
// any downgrade, the owned videos it was grounded in, and citation metadata
// -- never raw captions, transcripts, or a separate "hidden" answer key.
export const WorkplacePracticeSetSchema = z
  .object({
    questions: z
      .array(LocalConceptQuizQuestionSchema)
      .length(WORKPLACE_PRACTICE_SET_QUESTION_COUNT),
    requestedPolicy: WorkplacePracticePolicySchema,
    effectivePolicy: WorkplacePracticePolicySchema,
    rationale: z.string().trim().min(1).max(600),
    videoIds: z.array(z.string().uuid()).min(1).max(20),
    transcriptComplete: z.boolean(),
    citations: z.array(WorkplaceCitationSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    value.questions.forEach((question, index) => {
      if (question.id !== `q${index + 1}`) {
        context.addIssue({
          code: "custom",
          path: ["questions", index, "id"],
          message: "Practice set question IDs must be ordered q1 through q5.",
        });
      }
    });
    if (
      value.requestedPolicy === "practice" &&
      value.effectivePolicy !== "practice"
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectivePolicy"],
        message:
          "A practice request cannot be silently upgraded into a diagnostic assessment.",
      });
    }
    const ownedVideoIds = new Set(value.videoIds);
    value.citations.forEach((citation, index) => {
      if (!ownedVideoIds.has(citation.videoId)) {
        context.addIssue({
          code: "custom",
          path: ["citations", index, "videoId"],
          message: "Citations must ground into one of the owned video IDs.",
        });
      }
    });
  });
export type WorkplacePracticeSet = z.infer<typeof WorkplacePracticeSetSchema>;

export const WorkplaceTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(WORKPLACE_MESSAGE_TEXT_MAX_LENGTH),
  })
  .strict();

export const WorkplaceCitationPartSchema = z
  .object({
    type: z.literal("citation"),
    citation: WorkplaceCitationSchema,
  })
  .strict();

export const WorkplaceToolStatusPartSchema = z
  .object({
    type: z.literal("tool_status"),
    tool: WorkplaceToolStatusSchema,
  })
  .strict();

export const WorkplacePracticeSetPartSchema = z
  .object({
    type: z.literal("practice_set"),
    practiceSet: WorkplacePracticeSetSchema,
  })
  .strict();

export const WorkplaceMessagePartSchema = z.discriminatedUnion("type", [
  WorkplaceTextPartSchema,
  WorkplaceCitationPartSchema,
  WorkplaceToolStatusPartSchema,
  WorkplacePracticeSetPartSchema,
]);
export type WorkplaceMessagePart = z.infer<typeof WorkplaceMessagePartSchema>;

export const WorkplaceMessageRoleSchema = z.enum(["user", "assistant"]);
export type WorkplaceMessageRole = z.infer<typeof WorkplaceMessageRoleSchema>;

export const WorkplaceMessageSchema = z
  .object({
    id: z.string().uuid(),
    threadId: z.string().uuid(),
    clientMessageId: z.string().trim().min(1).max(100),
    role: WorkplaceMessageRoleSchema,
    parts: z.array(WorkplaceMessagePartSchema).min(1).max(20),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkplaceMessage = z.infer<typeof WorkplaceMessageSchema>;

export const WorkplaceMessageSyncRequestSchema = z
  .object({
    threadId: z.string().uuid(),
    clientMessageId: z.string().trim().min(1).max(100),
    role: WorkplaceMessageRoleSchema,
    parts: z.array(WorkplaceMessagePartSchema).min(1).max(20),
  })
  .strict();
export type WorkplaceMessageSyncRequest = z.infer<
  typeof WorkplaceMessageSyncRequestSchema
>;

export const WorkplaceMessageSyncResponseSchema = z
  .object({ message: WorkplaceMessageSchema })
  .strict();
export type WorkplaceMessageSyncResponse = z.infer<
  typeof WorkplaceMessageSyncResponseSchema
>;

export const WorkplaceThreadSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    messageCount: z.number().int().nonnegative(),
    lastMessageAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkplaceThreadSummary = z.infer<
  typeof WorkplaceThreadSummarySchema
>;

export const WorkplaceThreadCreateRequestSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional() })
  .strict();
export type WorkplaceThreadCreateRequest = z.infer<
  typeof WorkplaceThreadCreateRequestSchema
>;

export const WorkplaceThreadResponseSchema = z
  .object({ thread: WorkplaceThreadSummarySchema })
  .strict();
export type WorkplaceThreadResponse = z.infer<
  typeof WorkplaceThreadResponseSchema
>;

export const WorkplaceThreadRenameRequestSchema = z
  .object({ title: z.string().trim().min(1).max(200) })
  .strict();
export type WorkplaceThreadRenameRequest = z.infer<
  typeof WorkplaceThreadRenameRequestSchema
>;

export const WorkplaceThreadListResponseSchema = z
  .object({ threads: z.array(WorkplaceThreadSummarySchema).max(200) })
  .strict();
export type WorkplaceThreadListResponse = z.infer<
  typeof WorkplaceThreadListResponseSchema
>;

export const WorkplaceThreadDeleteResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
export type WorkplaceThreadDeleteResponse = z.infer<
  typeof WorkplaceThreadDeleteResponseSchema
>;

export const WORKPLACE_MESSAGES_DEFAULT_PAGE_SIZE = 50;
export const WORKPLACE_MESSAGES_MAX_PAGE_SIZE = 100;

export const WorkplaceMessagesRequestSchema = z
  .object({
    threadId: z.string().uuid(),
    cursor: z.string().trim().min(1).max(200).nullable().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(WORKPLACE_MESSAGES_MAX_PAGE_SIZE)
      .default(WORKPLACE_MESSAGES_DEFAULT_PAGE_SIZE),
  })
  .strict();
export type WorkplaceMessagesRequest = z.infer<
  typeof WorkplaceMessagesRequestSchema
>;

export const WorkplaceMessagesResponseSchema = z
  .object({
    messages: z
      .array(WorkplaceMessageSchema)
      .max(WORKPLACE_MESSAGES_MAX_PAGE_SIZE),
    nextCursor: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();
export type WorkplaceMessagesResponse = z.infer<
  typeof WorkplaceMessagesResponseSchema
>;

const WORKPLACE_TOOL_ARGUMENT_KEY_SCHEMA = z.string().trim().min(1).max(64);
const WorkplaceToolArgumentValueSchema = z.union([
  z.string().trim().max(500),
  z.number(),
  z.boolean(),
]);
const WORKPLACE_MAX_TOOL_ARGUMENT_KEYS = 12;
// Credential-shaped keys must never appear in a tool call, even inside an
// otherwise free-form arguments map.
const WORKPLACE_FORBIDDEN_ARGUMENT_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "token",
  "password",
  "authorization",
  "credential",
  "credentials",
]);

export const WorkplaceLocalToolCallSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: WorkplaceToolNameSchema,
    arguments: z
      .record(
        WORKPLACE_TOOL_ARGUMENT_KEY_SCHEMA,
        WorkplaceToolArgumentValueSchema,
      )
      .refine(
        (value) =>
          Object.keys(value).length <= WORKPLACE_MAX_TOOL_ARGUMENT_KEYS,
        { message: "Tool arguments must stay within a bounded key count." },
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const forbiddenKey = Object.keys(value.arguments).find((key) =>
      WORKPLACE_FORBIDDEN_ARGUMENT_KEYS.has(key.trim().toLowerCase()),
    );
    if (forbiddenKey) {
      context.addIssue({
        code: "custom",
        path: ["arguments", forbiddenKey],
        message:
          "Tool arguments cannot carry credential-shaped keys such as API keys or tokens.",
      });
    }
  });
export type WorkplaceLocalToolCall = z.infer<
  typeof WorkplaceLocalToolCallSchema
>;

export const WorkplaceLocalToolResultSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: WorkplaceToolNameSchema,
    status: z.enum(["ok", "error"]),
    summary: z.string().trim().min(1).max(500),
    citations: z.array(WorkplaceCitationSchema).max(5).default([]),
  })
  .strict();
export type WorkplaceLocalToolResult = z.infer<
  typeof WorkplaceLocalToolResultSchema
>;

export const WorkplaceLocalChatRequestSchema = z
  .object({
    threadId: z.string().uuid(),
    clientMessageId: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(WORKPLACE_MESSAGE_TEXT_MAX_LENGTH),
    recentVideoIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();
export type WorkplaceLocalChatRequest = z.infer<
  typeof WorkplaceLocalChatRequestSchema
>;

export const WorkplaceTextDeltaEventSchema = z
  .object({
    type: z.literal("text_delta"),
    delta: z.string().min(1).max(2_000),
  })
  .strict();

export const WorkplaceTextCompleteEventSchema = z
  .object({
    type: z.literal("text_complete"),
    text: z.string().min(1).max(WORKPLACE_MESSAGE_TEXT_MAX_LENGTH),
  })
  .strict();

export const WorkplaceToolRequestedEventSchema = z
  .object({
    type: z.literal("tool_requested"),
    toolCall: WorkplaceLocalToolCallSchema,
  })
  .strict();

export const WorkplaceToolRunningEventSchema = z
  .object({
    type: z.literal("tool_running"),
    toolCallId: z.string().trim().min(1).max(80),
    name: WorkplaceToolNameSchema,
  })
  .strict();

export const WorkplaceToolResultEventSchema = z
  .object({
    type: z.literal("tool_result"),
    toolResult: WorkplaceLocalToolResultSchema,
  })
  .strict();

export const WorkplaceToolErrorEventSchema = z
  .object({
    type: z.literal("tool_error"),
    toolCallId: z.string().trim().min(1).max(80),
    name: WorkplaceToolNameSchema,
    errorCode: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const WorkplacePracticeSetEventSchema = z
  .object({
    type: z.literal("practice_set"),
    practiceSet: WorkplacePracticeSetSchema,
  })
  .strict();

export const WorkplaceErrorEventSchema = z
  .object({
    type: z.literal("error"),
    code: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const WorkplaceCompleteEventSchema = z
  .object({ type: z.literal("complete") })
  .strict();

export const WorkplaceLocalChatEventSchema = z.discriminatedUnion("type", [
  WorkplaceTextDeltaEventSchema,
  WorkplaceTextCompleteEventSchema,
  WorkplaceToolRequestedEventSchema,
  WorkplaceToolRunningEventSchema,
  WorkplaceToolResultEventSchema,
  WorkplaceToolErrorEventSchema,
  WorkplacePracticeSetEventSchema,
  WorkplaceErrorEventSchema,
  WorkplaceCompleteEventSchema,
]);
export type WorkplaceLocalChatEvent = z.infer<
  typeof WorkplaceLocalChatEventSchema
>;

export const WorkplacePracticeSetImportRequestSchema = z
  .object({
    threadId: z.string().uuid(),
    practiceSet: WorkplacePracticeSetSchema,
  })
  .strict();
export type WorkplacePracticeSetImportRequest = z.infer<
  typeof WorkplacePracticeSetImportRequestSchema
>;

export const WorkplacePracticeSetImportResponseSchema = z
  .object({
    quizId: z.string().uuid(),
    messageId: z.string().uuid(),
    affectsMastery: z.boolean(),
  })
  .strict();
export type WorkplacePracticeSetImportResponse = z.infer<
  typeof WorkplacePracticeSetImportResponseSchema
>;

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
export function identifyVideoSource(rawUrl: string): VideoSource | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (youtubeHosts.has(host)) return "youtube";
    return null;
  } catch {
    return null;
  }
}

export function questionLimitForSession(
  length: SessionLength,
  customQuestionCount?: number,
): number {
  if (length === "custom") {
    return QuestionCountSchema.parse(customQuestionCount);
  }
  return length === "short" ? 5 : length === "medium" ? 10 : 15;
}

export function questionTypePlanForSelection(
  types: QuizQuestionType[],
  questionCount: number,
): QuizQuestionType[] {
  const selected = QuizQuestionTypesSchema.parse(types);
  QuestionCountSchema.parse(questionCount);
  if (questionCount < selected.length) {
    throw new Error(
      "A question type plan needs at least one question for each selected type.",
    );
  }
  return Array.from(
    { length: questionCount },
    (_, index) => selected[index % selected.length]!,
  );
}

export function questionPlanMatchesSelection(
  plan: LocalQuestionPlan,
  types: QuizQuestionType[],
  questionCount: number,
): boolean {
  const parsedPlan = LocalQuestionPlanSchema.safeParse(plan);
  const parsedTypes = QuizQuestionTypesSchema.safeParse(types);
  if (
    !parsedPlan.success ||
    !parsedTypes.success ||
    parsedPlan.data.types.length !== questionCount ||
    parsedPlan.data.types[0] !== parsedTypes.data[0]
  ) {
    return false;
  }
  const selected = new Set(parsedTypes.data);
  if (parsedPlan.data.types.some((type) => !selected.has(type))) return false;
  const counts = parsedTypes.data.map(
    (type) => parsedPlan.data.types.filter((slot) => slot === type).length,
  );
  return (
    counts.every((count) => count > 0) &&
    Math.max(...counts) - Math.min(...counts) <= 1
  );
}
