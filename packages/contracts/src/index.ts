import { z } from "zod";

export * from "./admin";

export const SourceSchema = z.literal("youtube");
export type VideoSource = z.infer<typeof SourceSchema>;

export const LanguageSchema = z.enum(["en", "zh-CN"]);
export type AppLanguage = z.infer<typeof LanguageSchema>;

export const SessionLengthSchema = z.enum(["short", "medium", "long"]);
export type SessionLength = z.infer<typeof SessionLengthSchema>;

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
  "learning",
  "mastered",
]);
export type MasteryState = z.infer<typeof MasteryStateSchema>;

export const GenerationStageSchema = z.enum([
  "getting_video",
  "preparing_audio",
  "downloading_model",
  "transcribing_device",
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

export const TranscriptionModeSchema = z.enum([
  "captions",
  "browser_tab_capture",
  "device_media",
]);
export type TranscriptionMode = z.infer<typeof TranscriptionModeSchema>;

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
    transcriptionMode: TranscriptionModeSchema,
    capture: z.object({
      expectedDurationSeconds: z.number().int().nonnegative(),
      requiresUserGesture: z.boolean(),
    }),
    requiresLocalTranscription: z.boolean(),
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

export const MediaResolveRequestSchema = z.object({
  videoId: z.string().uuid(),
});
export type MediaResolveRequest = z.infer<typeof MediaResolveRequestSchema>;

export const MediaResolveResponseSchema = z.object({
  mediaUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  maximumDurationSeconds: z.literal(5_400),
});
export type MediaResolveResponse = z.infer<typeof MediaResolveResponseSchema>;

export const LOCAL_QUIZ_PROTOCOL_VERSION = 1 as const;
export const LOCAL_QUIZ_RESULT_PROTOCOL_VERSION = 5 as const;
export const LOCAL_QUIZ_PIPELINE_VERSION = 9 as const;
export const LOCAL_QUIZ_MODEL = "deepseek-v4-flash" as const;
export const LOCAL_QUIZ_PROMPT_VERSION = "quiz-local-json-stream-v5.0" as const;
export const LOCAL_QUIZ_VALIDATOR_VERSION =
  "validator-local-progressive-v4.0" as const;
export const LOCAL_QUIZ_PROGRESSIVE_IMPORT_VERSION =
  "extension-progressive-import-v3" as const;
export const LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY =
  "question-stream-v1" as const;

export const LocalAcceptedQuestionSummarySchema = z
  .object({
    id: z.string().regex(/^q(?:[1-9]|1[0-5])$/),
    type: z.enum(["multiple_choice", "true_false", "short_answer"]),
    concept: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(700),
  })
  .strict();
export type LocalAcceptedQuestionSummary = z.infer<
  typeof LocalAcceptedQuestionSummarySchema
>;

export const LocalQuizContextSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_PROTOCOL_VERSION),
    jobId: z.string().uuid(),
    videoId: z.string().uuid(),
    title: z.string().min(1).max(500),
    quizLanguage: LanguageSchema,
    questionTypes: QuizQuestionTypesSchema,
    questionCount: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    transcriptFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
    transcriptLanguage: z.string().min(2).max(35),
    segments: z
      .array(TranscriptSegmentSchema)
      .min(1)
      .max(MAX_COMPLETE_TRANSCRIPT_SEGMENTS),
    continuation: z
      .object({
        startIndex: z.number().int().min(1).max(14),
        acceptedQuestions: z
          .array(LocalAcceptedQuestionSummarySchema)
          .min(1)
          .max(14),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.continuation) return;
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
    const typePlan = questionTypePlanForSelection(
      value.questionTypes,
      value.questionCount,
    );
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
    id: z.string().regex(/^q(?:[1-9]|1[0-5])$/),
    concept: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(700),
    explanation: z.string().trim().min(1).max(1_500),
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

export const LocalShortAnswerQuestionSchema = LocalQuestionBaseSchema.extend({
  type: z.literal("short_answer"),
  answer: z.string().trim().min(1).max(1_000),
  rubricIdeas: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  acceptableAnswers: z.array(z.string().trim().min(1).max(1_000)).max(8),
}).strict();

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
    questions: z.array(LocalConceptQuizQuestionSchema).min(5).max(15),
  })
  .strict()
  .superRefine((quiz, context) => {
    if (![5, 10, 15].includes(quiz.questions.length)) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "A local quiz must contain exactly 5, 10, or 15 questions.",
      });
    }
    const prompts = new Set<string>();
    quiz.questions.forEach((question, index) => {
      if (question.id !== `q${index + 1}`) {
        context.addIssue({
          code: "custom",
          path: ["questions", index, "id"],
          message: "Question IDs must be ordered q1 through q15.",
        });
      }
      const prompt = question.question.trim().toLocaleLowerCase();
      if (prompts.has(prompt)) {
        context.addIssue({
          code: "custom",
          path: ["questions", index, "question"],
          message: "Question prompts must be unique.",
        });
      }
      prompts.add(prompt);
    });
  });
export type LocalConceptQuiz = z.infer<typeof LocalConceptQuizSchema>;

function localQuizMetricsSchema(minimumAiCalls: 0 | 1) {
  return z
    .object({
      aiCalls: z.number().int().min(minimumAiCalls).max(45),
      retryCount: z.number().int().min(0).max(30),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      reasoningTokens: z.number().int().nonnegative(),
      elapsedMs: z.number().int().positive(),
    })
    .strict();
}

const LocalQuizMetricsSchema = localQuizMetricsSchema(1);
const LocalQuizChunkMetricsSchema = localQuizMetricsSchema(0);

export const LocalConceptQuizResultSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: z.literal(LOCAL_QUIZ_PROMPT_VERSION),
    validatorVersion: z.literal(LOCAL_QUIZ_VALIDATOR_VERSION),
    quiz: LocalConceptQuizSchema,
    metrics: LocalQuizMetricsSchema,
  })
  .strict();
export type LocalConceptQuizResult = z.infer<
  typeof LocalConceptQuizResultSchema
>;

export const LocalConceptQuizContinuationResultSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: z.literal(LOCAL_QUIZ_PROMPT_VERSION),
    validatorVersion: z.literal(LOCAL_QUIZ_VALIDATOR_VERSION),
    title: z.string().trim().min(1).max(300),
    generatedStartIndex: z.number().int().min(1).max(14),
    totalQuestions: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    metrics: LocalQuizMetricsSchema,
  })
  .strict();
export const LocalConceptQuizGenerationResultSchema = z.union([
  LocalConceptQuizResultSchema,
  LocalConceptQuizContinuationResultSchema,
]);
export type LocalConceptQuizGenerationResult = z.infer<
  typeof LocalConceptQuizGenerationResultSchema
>;

export const LocalConceptQuizQuestionChunkSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_RESULT_PROTOCOL_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: z.literal(LOCAL_QUIZ_PROMPT_VERSION),
    validatorVersion: z.literal(LOCAL_QUIZ_VALIDATOR_VERSION),
    title: z.string().trim().min(1).max(300),
    startIndex: z.number().int().min(0).max(14),
    totalQuestions: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    question: LocalConceptQuizQuestionSchema,
    metrics: LocalQuizChunkMetricsSchema,
  })
  .strict()
  .superRefine((value, context) => {
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
    questionTypes: QuizQuestionTypesSchema,
    watched: z.boolean(),
    chunk: LocalConceptQuizQuestionChunkSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedCount = questionLimitForSession(value.sessionLength);
    if (value.chunk.totalQuestions !== expectedCount) {
      context.addIssue({
        code: "custom",
        path: ["chunk", "totalQuestions"],
        message: "The planned quiz count must match the session length.",
      });
    }
    const expectedTypes = questionTypePlanForSelection(
      value.questionTypes,
      expectedCount,
    );
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

export const AttemptGenerationAvailabilitySchema = z
  .object({
    state: z.enum(["generating", "retrying", "retry_required", "ready"]),
    availableQuestions: z.number().int().min(1).max(15),
    totalQuestions: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
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
    if (value.reasonCode && value.state !== "retry_required") {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only an action-required state may include a reason code.",
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
    state: z.enum(["retrying", "retry_required"]),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reasonCode && value.state !== "retry_required") {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Only retry_required may include a reason code.",
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
        questionTypes: QuizQuestionTypesSchema,
        watched: z.boolean(),
        startIndex: z.number().int().min(1).max(14),
        acceptedQuestions: z
          .array(LocalAcceptedQuestionSummarySchema)
          .min(1)
          .max(14),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.continuation) return;
    if (
      value.generation.state === "ready" ||
      value.continuation.startIndex !== value.generation.availableQuestions ||
      value.continuation.acceptedQuestions.length !==
        value.continuation.startIndex ||
      questionLimitForSession(value.continuation.sessionLength) !==
        value.generation.totalQuestions
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "Continuation must describe the authoritative missing suffix.",
      });
      return;
    }
    const typePlan = questionTypePlanForSelection(
      value.continuation.questionTypes,
      value.generation.totalQuestions,
    );
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

export const ExtensionQuizImportRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    quizLanguage: LanguageSchema,
    sessionLength: SessionLengthSchema,
    questionTypes: QuizQuestionTypesSchema,
    watched: z.boolean(),
    quiz: LocalConceptQuizResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedCount = questionLimitForSession(value.sessionLength);
    if (value.quiz.quiz.questions.length !== expectedCount) {
      context.addIssue({
        code: "custom",
        path: ["quiz", "quiz", "questions"],
        message: "The quiz count must match the requested session length.",
      });
    }
    const expectedTypes = questionTypePlanForSelection(
      value.questionTypes,
      expectedCount,
    );
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

export const QuizStartRequestSchema = z.object({
  mode: z.enum(["learn", "review"]).default("learn"),
  sessionLength: SessionLengthSchema,
  questionTypes: QuizQuestionTypesSchema.default(DEFAULT_QUIZ_QUESTION_TYPES),
  watched: z.boolean().optional(),
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
  question: PublicQuestionSchema.nullable(),
  completed: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  mastery: MasteryStateSchema.nullable(),
  generation: AttemptGenerationAvailabilitySchema,
});
export type AttemptResumeResponse = z.infer<typeof AttemptResumeResponseSchema>;

export const LibraryCardSchema = z.object({
  videoId: z.string().uuid(),
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
});
export type LibraryCard = z.infer<typeof LibraryCardSchema>;

export const LibraryResponseSchema = z.object({
  dueReviews: z.array(LibraryCardSchema),
  saved: z.array(LibraryCardSchema),
  youtubeSuggestions: z.array(LibraryCardSchema),
});
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export const PushRegisterRequestSchema = z.object({
  token: z.string().min(8).max(1_000),
  platform: z.enum(["ios", "android", "web"]),
  locale: LanguageSchema,
});

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

export function questionLimitForSession(length: SessionLength): number {
  return length === "short" ? 5 : length === "medium" ? 10 : 15;
}

export function questionTypePlanForSelection(
  types: QuizQuestionType[],
  questionCount: number,
): QuizQuestionType[] {
  const selected = QuizQuestionTypesSchema.parse(types);
  if (![5, 10, 15].includes(questionCount)) {
    throw new Error("A question type plan must contain 5, 10, or 15 slots.");
  }
  return Array.from(
    { length: questionCount },
    (_, index) => selected[index % selected.length]!,
  );
}
