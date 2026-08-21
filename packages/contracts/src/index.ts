import { z } from "zod";

export * from "./admin";

export const SourceSchema = z.enum(["youtube", "bilibili"]);
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
      message: "Only HTTP(S) video links are supported",
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

export const TranscriptUploadRequestSchema = z
  .object({
    videoId: z.string().uuid(),
    language: z.string().min(2).max(35),
    origin: z.enum(["captions", "device_whisper", "browser_tab_capture"]),
    acquisition: z
      .enum([
        "server_captions",
        "youtube_signed_captions",
        "youtube_text_provider",
        "youtube_browser_extension",
        "device_whisper",
      ])
      .optional(),
    completeness: TranscriptCompletenessSchema,
    segments: z
      .array(TranscriptSegmentSchema)
      .min(1)
      .max(MAX_COMPLETE_TRANSCRIPT_SEGMENTS),
    quizLanguage: LanguageSchema,
    sessionLength: SessionLengthSchema,
    watched: z.boolean(),
    questionTypes: QuizQuestionTypesSchema.default(DEFAULT_QUIZ_QUESTION_TYPES),
  })
  .superRefine((value, context) => {
    if (
      !transcriptCompletenessMatches(
        value.completeness,
        value.segments,
        value.completeness.expectedDurationMs / 1_000,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["completeness"],
        message: "The transcript did not match its completeness manifest.",
      });
    }
  });
export type TranscriptUploadRequest = z.infer<
  typeof TranscriptUploadRequestSchema
>;

export const TranscriptUploadResponseSchema = z.object({
  jobId: z.string().uuid(),
  stage: GenerationStageSchema,
});
export type TranscriptUploadResponse = z.infer<
  typeof TranscriptUploadResponseSchema
>;

export const GenerationStatusSchema = z.object({
  jobId: z.string().uuid(),
  stage: GenerationStageSchema,
  progress: z.number().min(0).max(1),
  quizId: z.string().uuid().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const ConceptSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(600),
    evidenceSegmentIds: z.array(z.string()).min(1),
  })
  .strict();
export type Concept = z.infer<typeof ConceptSchema>;

const QuestionBaseSchema = z
  .object({
    id: z.string().min(1).max(80),
    conceptId: z.string().min(1).max(80),
    prompt: z.string().min(4).max(1_200),
    explanation: z.string().min(4).max(600),
    evidenceSegmentIds: z
      .array(z.string())
      .min(1)
      .max(MAX_COMPLETE_TRANSCRIPT_SEGMENTS),
    difficulty: z.number().int().min(1).max(5),
    reformulatedPrompt: z.string().min(4).max(1_200),
  })
  .strict();

export function normalizeQuizOption(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const MultipleChoiceQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("multiple_choice"),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
}).superRefine((question, context) => {
  const normalized = question.options.map(normalizeQuizOption);
  if (normalized.some((option) => !option)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Options must contain meaningful text",
    });
  }
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Options must be unique after normalization",
    });
  }
});

export const TrueFalseQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("true_false"),
  correctAnswer: z.boolean(),
});

export const OrderingQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("ordering"),
  items: z.array(z.string().min(1).max(300)).min(2).max(7),
  correctAnswer: z.array(z.number().int().nonnegative()).min(2).max(7),
}).refine(
  (question) =>
    question.correctAnswer.length === question.items.length &&
    new Set(question.correctAnswer).size === question.items.length &&
    question.correctAnswer.every((index) => index < question.items.length),
  { message: "correctAnswer must be a permutation of item indexes" },
);

export const ShortAnswerQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("short_answer"),
  rubric: z.object({
    requiredIdeas: z.array(z.string().min(1).max(300)).min(1).max(6),
    acceptableAlternatives: z.array(z.string().min(1).max(300)).max(10),
  }),
});

export const GeneratedQuestionSchema = z.discriminatedUnion("type", [
  MultipleChoiceQuestionSchema,
  TrueFalseQuestionSchema,
  ShortAnswerQuestionSchema,
]);
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const QuizGenerationSchema = z
  .object({
    educational: z.literal(true),
    classificationReason: z.string().min(4).max(500),
    sourceLanguage: z.string().min(2).max(35),
    primer: z.string().min(20).max(2_000),
    concepts: z.array(ConceptSchema).min(2).max(20),
    questions: z.array(GeneratedQuestionSchema).min(5).max(30),
  })
  .strict();
export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;

export const LOCAL_QUIZ_PROTOCOL_VERSION = 1 as const;
export const LOCAL_QUIZ_PIPELINE_VERSION = 5 as const;
export const LOCAL_QUIZ_MODEL = "deepseek-v4-flash" as const;
export const LOCAL_QUIZ_PROMPT_VERSION = "quiz-local-v1.0" as const;
export const LOCAL_QUIZ_VALIDATOR_VERSION = "validator-local-v1.0" as const;

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
  })
  .strict();
export type LocalQuizContext = z.infer<typeof LocalQuizContextSchema>;

export const LocalQuizSubmissionSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_QUIZ_PROTOCOL_VERSION),
    pipelineVersion: z.literal(LOCAL_QUIZ_PIPELINE_VERSION),
    model: z.literal(LOCAL_QUIZ_MODEL),
    reasoningEffort: z.literal("high"),
    promptVersion: z.literal(LOCAL_QUIZ_PROMPT_VERSION),
    validatorVersion: z.literal(LOCAL_QUIZ_VALIDATOR_VERSION),
    transcriptFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
    generation: QuizGenerationSchema,
    metrics: z
      .object({
        aiCalls: z.literal(1),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        reasoningTokens: z.number().int().nonnegative(),
        elapsedMs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type LocalQuizSubmission = z.infer<typeof LocalQuizSubmissionSchema>;

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
});
export type AttemptAnswerResponse = z.infer<typeof AttemptAnswerResponseSchema>;

export const AttemptResumeResponseSchema = z.object({
  attemptId: z.string().uuid(),
  question: PublicQuestionSchema.nullable(),
  completed: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  mastery: MasteryStateSchema.nullable(),
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
const bilibiliHosts = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
  "b23.tv",
]);

export function identifyVideoSource(rawUrl: string): VideoSource | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (youtubeHosts.has(host)) return "youtube";
    if (bilibiliHosts.has(host)) return "bilibili";
    return null;
  } catch {
    return null;
  }
}

export function questionLimitForSession(length: SessionLength): number {
  return length === "short" ? 5 : length === "medium" ? 10 : 15;
}
