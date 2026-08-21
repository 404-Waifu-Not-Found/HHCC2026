import {
  ConceptSchema,
  GeneratedQuestionSchema,
  QuizGenerationSchema,
  TranscriptCompletenessSchema,
  TranscriptSegmentSchema,
  questionLimitForSession,
  type Concept,
  type GeneratedQuestion,
  type QuizQuestionType,
  type QuizGeneration,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import type { AppEnv } from "../types";

const DeepSeekResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1) }),
      }),
    )
    .min(1),
});

const EducationClassificationSchema = z.object({
  educational: z.boolean(),
  reason: z.string().min(4).max(500),
});

const WrittenGradeSchema = z.object({
  correct: z.boolean(),
  feedback: z.string().min(4).max(500),
});

const HistoryClassificationSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string().min(1).max(80),
      educational: z.boolean(),
      reason: z.string().min(3).max(300),
    }),
  ),
});

const QuestionDraftBaseSchema = z.object({
  prompt: z.string().min(4).max(1_200),
  explanation: z.string().min(4).max(600),
  difficulty: z.number().int().min(1).max(5),
  reformulatedPrompt: z.string().min(4).max(1_200),
});

const GeneratedQuizItemDraftSchema = z.object({
  concept: ConceptSchema.omit({ id: true, evidenceSegmentIds: true }),
  question: z.union([
    QuestionDraftBaseSchema.extend({
      type: z.literal("multiple_choice"),
      options: z.array(z.string().min(1).max(500)).min(2).max(6),
      correctAnswer: z.number().int().nonnegative(),
    }).refine((question) => question.correctAnswer < question.options.length, {
      message: "correctAnswer must index an option",
    }),
    QuestionDraftBaseSchema.extend({
      type: z.literal("true_false"),
      correctAnswer: z.boolean(),
    }),
    QuestionDraftBaseSchema.extend({
      type: z.literal("short_answer"),
      rubric: z.object({
        requiredIdeas: z.array(z.string().min(1).max(300)).min(1).max(6),
        acceptableAlternatives: z.array(z.string().min(1).max(300)).max(10),
      }),
    }),
  ]),
});

const GeneratedQuizBatchResponseSchema = z.object({
  items: z.array(z.unknown()).min(1).max(5),
});

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type JsonRequestOptions = {
  operation?: string;
  maximumOutputTokens?: number;
  maximumAttempts?: number;
  timeoutMs?: number;
};

function logDeepSeek(
  event: string,
  details: Record<string, unknown>,
  level: "info" | "warn" = "info",
) {
  console[level](JSON.stringify({ scope: "deepseek", event, ...details }));
}

async function requestJson<T>(
  env: AppEnv,
  messages: DeepSeekMessage[],
  schema: z.ZodType<T>,
  options: JsonRequestOptions = {},
): Promise<T> {
  const maximumAttempts = options.maximumAttempts ?? 3;
  const operation = options.operation ?? "structured_json";
  let validationFeedback = "";
  let lastError = "No response";
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const startedAt = Date.now();
    logDeepSeek("request.started", {
      operation,
      attempt,
      maximumAttempts,
      model: env.DEEPSEEK_MODEL,
    });
    let response: Response;
    try {
      response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.DEEPSEEK_MODEL,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.25,
          ...(options.maximumOutputTokens
            ? { max_tokens: options.maximumOutputTokens }
            : {}),
          messages: [
            ...messages,
            ...(validationFeedback
              ? [
                  {
                    role: "user" as const,
                    content: `Your previous JSON was invalid. Fix only these issues and return a complete JSON object:\n${validationFeedback}`,
                  },
                ]
              : []),
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "TimeoutError"
          ? "DeepSeek timed out"
          : "DeepSeek request failed";
      logDeepSeek(
        "request.failed",
        {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          error: lastError,
        },
        "warn",
      );
      continue;
    }
    if (!response.ok) {
      lastError = `DeepSeek returned ${response.status}`;
      logDeepSeek(
        "request.failed",
        {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          status: response.status,
        },
        "warn",
      );
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    const envelope = DeepSeekResponseSchema.safeParse(await response.json());
    if (!envelope.success) {
      lastError = "DeepSeek returned an empty response";
      validationFeedback = envelope.error.message.slice(0, 1_500);
      logDeepSeek(
        "response.invalid",
        {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          reason: "empty_response",
        },
        "warn",
      );
      continue;
    }
    try {
      const firstChoice = envelope.data.choices.at(0);
      if (!firstChoice) throw new Error("DeepSeek returned no choices");
      const content = firstChoice.message.content
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = schema.safeParse(JSON.parse(content));
      if (parsed.success) {
        logDeepSeek("response.valid", {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          outputCharacters: content.length,
        });
        return parsed.data;
      }
      lastError = "DeepSeek returned invalid structured output";
      validationFeedback = parsed.error.message.slice(0, 2_000);
      logDeepSeek(
        "response.invalid",
        {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          reason: "schema_validation",
          issueCount: parsed.error.issues.length,
        },
        "warn",
      );
    } catch (error) {
      lastError = "DeepSeek returned malformed JSON";
      validationFeedback =
        error instanceof Error ? error.message.slice(0, 1_500) : lastError;
      logDeepSeek(
        "response.invalid",
        {
          operation,
          attempt,
          elapsedMs: Date.now() - startedAt,
          reason: "malformed_json",
        },
        "warn",
      );
    }
  }
  throw new ApiError(502, "deepseek_invalid_output", lastError);
}

function serializeTranscript(
  segments: TranscriptSegment[],
  maximumCharacters = 500_000,
): string {
  const lines = segments.map(
    (segment) => `[${segment.id}] ${segment.text.replaceAll("\n", " ").trim()}`,
  );
  if (lines.join("\n").length <= maximumCharacters) return lines.join("\n");

  const selected: string[] = [];
  const maximumLines = Math.max(
    2,
    Math.min(lines.length, Math.floor(maximumCharacters / 180)),
  );
  const perLine = Math.max(40, Math.floor(maximumCharacters / maximumLines));
  for (let index = 0; index < maximumLines; index += 1) {
    const sourceIndex = Math.round(
      (index * (lines.length - 1)) / Math.max(1, maximumLines - 1),
    );
    const line = lines[sourceIndex];
    if (line) selected.push(line.slice(0, perLine - 1));
  }
  return selected.join("\n").slice(0, maximumCharacters);
}

export function serializeFullSubtitles(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment, index) =>
        `[${index + 1}|${segment.id}|${segment.startMs}-${segment.endMs}] ${segment.text.replaceAll("\n", " ").trim()}`,
    )
    .join("\n");
}

export async function classifyTranscript(
  env: AppEnv,
  title: string,
  segments: TranscriptSegment[],
) {
  const fullSubtitles = serializeFullSubtitles(segments);
  try {
    return await requestJson(
      env,
      [
        {
          role: "system",
          content:
            "Classify whether a video meaningfully teaches knowledge or a skill to learners aged 13+. Return JSON with educational and a brief reason. Entertainment with incidental facts is not educational.",
        },
        {
          role: "user",
          content: `Title: ${title}\n\nComplete subtitle transcript (all ${segments.length} segments):\n${fullSubtitles}`,
        },
      ],
      EducationClassificationSchema,
      {
        operation: "classify_transcript",
        maximumOutputTokens: 160,
        maximumAttempts: 1,
        timeoutMs: 7_500,
      },
    );
  } catch {
    const transcriptCharacters = segments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    );
    const educational = segments.length >= 5 && transcriptCharacters >= 500;
    logDeepSeek(
      "classification.fallback",
      { segmentCount: segments.length, transcriptCharacters, educational },
      "warn",
    );
    return {
      educational,
      reason: educational
        ? "The transcript contains enough structured material to build a grounded quiz."
        : "The transcript does not contain enough material to build a grounded quiz.",
    };
  }
}

export async function generateQuiz(
  env: AppEnv,
  input: {
    title: string;
    language: "en" | "zh-CN";
    sessionLength: "short" | "medium" | "long";
    watched: boolean;
    segments: TranscriptSegment[];
    questionTypes: QuizQuestionType[];
  },
): Promise<QuizGeneration> {
  const questionCount = questionLimitForSession(input.sessionLength);
  const fullSubtitles = serializeFullSubtitles(input.segments);
  const generatedItems: Array<{
    concept: Concept;
    question: GeneratedQuestion;
  }> = [];
  const startedAt = Date.now();
  const batches: Array<
    Promise<Array<{ concept: Concept; question: GeneratedQuestion }>>
  > = [];
  for (let offset = 0; offset < questionCount; offset += 5) {
    const batchNumber = batches.length + 1;
    const batchStartedAt = Date.now();
    const indexes = Array.from(
      { length: Math.min(5, questionCount - offset) },
      (_, batchIndex) => offset + batchIndex,
    );
    batches.push(
      generateQuizBatch(env, input, indexes, questionCount, fullSubtitles).then(
        (items) => {
          logDeepSeek("batch.completed", {
            batchNumber,
            questionCount: items.length,
            elapsedMs: Date.now() - batchStartedAt,
          });
          return items;
        },
      ),
    );
  }
  generatedItems.push(...(await Promise.all(batches)).flat());
  const conceptTitles = generatedItems
    .slice(0, 4)
    .map((item) => item.concept.title)
    .join(", ");
  const generated = QuizGenerationSchema.parse({
    educational: true,
    classificationReason:
      "The transcript contains structured instructional material.",
    sourceLanguage: input.language,
    primer:
      input.language === "zh-CN"
        ? `本次测验聚焦于${conceptTitles}。请用视频中的证据作答，并在需要时复习相关片段。`
        : `This quiz focuses on ${conceptTitles}. Answer from the video evidence and revisit the relevant ideas when needed.`,
    concepts: generatedItems.map((item) => item.concept),
    questions: generatedItems.map((item) => item.question),
  });
  validateEvidence(generated, input.segments);
  logDeepSeek("quiz.completed", {
    questionCount,
    batchCount: batches.length,
    questionTypes: input.questionTypes,
    transcriptSegmentCount: input.segments.length,
    fullSubtitleCharacters: fullSubtitles.length,
    firstTranscriptMs: input.segments.at(0)?.startMs ?? null,
    lastTranscriptMs: input.segments.at(-1)?.endMs ?? null,
    elapsedMs: Date.now() - startedAt,
  });
  return generated;
}

async function generateQuizBatch(
  env: AppEnv,
  input: {
    title: string;
    language: "en" | "zh-CN";
    sessionLength: "short" | "medium" | "long";
    watched: boolean;
    segments: TranscriptSegment[];
    questionTypes: QuizQuestionType[];
  },
  indexes: number[],
  questionCount: number,
  fullSubtitles: string,
): Promise<Array<{ concept: Concept; question: GeneratedQuestion }>> {
  const requirements = indexes.map((index, position) => {
    const questionType =
      input.questionTypes[index % input.questionTypes.length] ??
      "multiple_choice";
    const evidence = selectEvidenceWindow(input.segments, index, questionCount);
    const evidenceStartLine =
      Math.floor((index * input.segments.length) / questionCount) + 1;
    const evidenceEndLine = Math.floor(
      ((index + 1) * input.segments.length) / questionCount,
    );
    return {
      index,
      position,
      questionType,
      evidence,
      prompt: `Item ${position + 1}\nRequired question type: ${questionType}\nRequired evidence lines from the complete transcript: ${evidenceStartLine}-${Math.max(evidenceStartLine, evidenceEndLine)}`,
    };
  });
  logDeepSeek("batch.started", {
    questionIndexes: indexes.map((index) => index + 1),
    transcriptCoverage: "complete",
    transcriptSegmentCount: input.segments.length,
    fullSubtitleCharacters: fullSubtitles.length,
    firstTranscriptMs: input.segments.at(0)?.startMs ?? null,
    lastTranscriptMs: input.segments.at(-1)?.endMs ?? null,
  });
  try {
    const response = await requestJson(
      env,
      [
        {
          role: "system",
          content:
            "Create the requested concise evidence-grounded quiz items after reading every line of the complete subtitle transcript. Return JSON exactly as {items: [{concept: {title, summary}, question: {...}}]} in the same order as the requested items. Question keys: type, prompt, explanation, difficulty (1-5), reformulatedPrompt. For multiple_choice add options and zero-based correctAnswer; for true_false add boolean correctAnswer; for short_answer add rubric {requiredIdeas, acceptableAlternatives}. Use the entire transcript for lesson context, ground each question and answer in its required line range, and keep explanations to one sentence.",
        },
        {
          role: "user",
          content: `Video: ${input.title}\nLanguage: ${input.language}\n\nComplete subtitle transcript (all ${input.segments.length} segments):\n${fullSubtitles}\n\nRequested items:\n${requirements.map((requirement) => requirement.prompt).join("\n\n")}`,
        },
      ],
      GeneratedQuizBatchResponseSchema,
      {
        operation: `generate_questions_${indexes[0]! + 1}_${indexes.at(-1)! + 1}`,
        maximumOutputTokens: 4_800,
        maximumAttempts: 1,
        timeoutMs: 7_500,
      },
    );
    return requirements.map((requirement) => {
      const parsed = GeneratedQuizItemDraftSchema.safeParse(
        response.items[requirement.position],
      );
      if (
        parsed.success &&
        parsed.data.question.type === requirement.questionType
      ) {
        return materializeQuizItem(
          parsed.data,
          requirement.evidence,
          requirement.index,
        );
      }
      logDeepSeek(
        "question.fallback",
        {
          questionIndex: requirement.index + 1,
          questionType: requirement.questionType,
          reason: parsed.success ? "wrong_type" : "invalid_item",
        },
        "warn",
      );
      return fallbackQuizItem(
        requirement.evidence,
        requirement.index,
        requirement.questionType,
        input.language,
      );
    });
  } catch {
    return requirements.map((requirement) => {
      logDeepSeek(
        "question.fallback",
        {
          questionIndex: requirement.index + 1,
          questionType: requirement.questionType,
          reason: "batch_failed",
        },
        "warn",
      );
      return fallbackQuizItem(
        requirement.evidence,
        requirement.index,
        requirement.questionType,
        input.language,
      );
    });
  }
}

export function selectEvidenceWindow(
  segments: TranscriptSegment[],
  index: number,
  questionCount: number,
): TranscriptSegment[] {
  if (segments.length === 0) return [];
  const start = Math.floor((index * segments.length) / questionCount);
  const end = Math.max(
    start + 1,
    Math.floor(((index + 1) * segments.length) / questionCount),
  );
  return segments.slice(start, end);
}

function materializeQuizItem(
  draft: z.infer<typeof GeneratedQuizItemDraftSchema>,
  evidence: TranscriptSegment[],
  index: number,
): { concept: Concept; question: GeneratedQuestion } {
  const conceptId = `concept-${index + 1}`;
  const evidenceSegmentIds = evidence.map((segment) => segment.id);
  return {
    concept: ConceptSchema.parse({
      ...draft.concept,
      id: conceptId,
      evidenceSegmentIds,
    }),
    question: GeneratedQuestionSchema.parse({
      ...draft.question,
      id: `question-${index + 1}`,
      conceptId,
      evidenceSegmentIds,
    }),
  };
}

function fallbackQuizItem(
  evidence: TranscriptSegment[],
  index: number,
  questionType: QuizQuestionType,
  language: "en" | "zh-CN",
): { concept: Concept; question: GeneratedQuestion } {
  const conceptId = `concept-${index + 1}`;
  const evidenceSegmentIds = evidence.map((segment) => segment.id);
  const sourceStatements = evidence
    .slice(0, 3)
    .map((segment) => segment.text.trim().slice(0, 240));
  const focus = sourceStatements[0] ?? "the topic in this section";
  const common = {
    id: `question-${index + 1}`,
    conceptId,
    evidenceSegmentIds,
    difficulty: 2,
    explanation:
      language === "zh-CN"
        ? `视频在此处说明：${focus}`
        : `The video states: ${focus}`,
    reformulatedPrompt:
      language === "zh-CN"
        ? `请用自己的话解释：${focus}`
        : `Explain this idea in your own words: ${focus}`,
  };
  const question =
    questionType === "multiple_choice"
      ? {
          ...common,
          type: questionType,
          prompt:
            language === "zh-CN"
              ? "视频在这一部分说明了什么？"
              : "What does the video explain in this section?",
          options: [focus, "This topic is not discussed in the video."],
          correctAnswer: 0,
        }
      : questionType === "true_false"
        ? {
            ...common,
            type: questionType,
            prompt:
              language === "zh-CN"
                ? `判断正误：${focus}`
                : `True or false: ${focus}`,
            correctAnswer: true,
          }
        : {
            ...common,
            type: questionType,
            prompt:
              language === "zh-CN"
                ? "视频对这一观点给出了怎样的解释？"
                : "How does the video explain this idea?",
            rubric: { requiredIdeas: [focus], acceptableAlternatives: [] },
          };
  return {
    concept: ConceptSchema.parse({
      id: conceptId,
      title: focus.slice(0, 80),
      summary: focus,
      evidenceSegmentIds,
    }),
    question: GeneratedQuestionSchema.parse(question),
  };
}

function validateEvidence(
  generation: QuizGeneration,
  segments: TranscriptSegment[],
): void {
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const conceptIds = new Set(generation.concepts.map((concept) => concept.id));
  for (const concept of generation.concepts) {
    if (concept.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
      throw new ApiError(
        502,
        "ungrounded_generation",
        "A generated concept cited transcript evidence that does not exist.",
      );
    }
  }
  for (const question of generation.questions) {
    if (
      !conceptIds.has(question.conceptId) ||
      question.evidenceSegmentIds.some((id) => !segmentIds.has(id))
    ) {
      throw new ApiError(
        502,
        "ungrounded_generation",
        "A generated question was not grounded in the video transcript.",
      );
    }
  }
}

export async function gradeWrittenAnswer(
  env: AppEnv,
  input: {
    prompt: string;
    answer: string;
    requiredIdeas: string[];
    acceptableAlternatives: string[];
    evidence: TranscriptSegment[];
  },
): Promise<{ correct: boolean; feedback: string }> {
  return requestJson(
    env,
    [
      {
        role: "system",
        content:
          "Grade a learner answer using only the supplied rubric and video evidence. Accept equivalent wording. Return strict JSON: correct boolean and one- or two-sentence feedback. Do not add outside facts.",
      },
      {
        role: "user",
        content: `Question: ${input.prompt}\nLearner answer: ${input.answer}\nRequired ideas: ${JSON.stringify(input.requiredIdeas)}\nAcceptable alternatives: ${JSON.stringify(input.acceptableAlternatives)}\nVideo evidence:\n${serializeTranscript(input.evidence, 20_000)}`,
      },
    ],
    WrittenGradeSchema,
    { operation: "grade_written_answer", maximumOutputTokens: 300 },
  );
}

export async function classifyHistoryTitles(
  env: AppEnv,
  candidates: Array<{ id: string; title: string }>,
): Promise<Map<string, string>> {
  const result = await requestJson(
    env,
    [
      {
        role: "system",
        content:
          "Classify YouTube history titles for meaningful high-school, college, language, technical, academic, or practical skill learning. Return strict JSON with candidates, preserving each id, educational boolean, and a brief reason. Reject entertainment, music, gossip, gaming highlights, and vague clickbait unless the title clearly signals instruction.",
      },
      {
        role: "user",
        content: `Classify these titles. Return every id exactly once:\n${JSON.stringify(candidates)}`,
      },
    ],
    HistoryClassificationSchema,
    { operation: "classify_history", maximumOutputTokens: 2_000 },
  );
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  return new Map(
    result.candidates
      .filter(
        (candidate) => candidate.educational && allowedIds.has(candidate.id),
      )
      .map((candidate) => [candidate.id, candidate.reason]),
  );
}

export const StoredTranscriptSchema = z.object({
  version: z.literal(1),
  videoId: z.string().uuid(),
  language: z.string(),
  origin: z.enum(["captions", "device_whisper", "browser_tab_capture"]),
  completeness: TranscriptCompletenessSchema,
  segments: z.array(TranscriptSegmentSchema).min(1),
});

export function questionStorageFields(question: GeneratedQuestion) {
  return {
    optionsJson:
      question.type === "multiple_choice"
        ? JSON.stringify(question.options)
        : null,
    itemsJson: null,
    correctAnswerJson:
      question.type === "short_answer"
        ? null
        : JSON.stringify(question.correctAnswer),
    rubricJson:
      question.type === "short_answer" ? JSON.stringify(question.rubric) : null,
  };
}
