import {
  ConceptSchema,
  GeneratedQuestionSchema,
  QuizGenerationSchema,
  TranscriptSegmentSchema,
  questionLimitForSession,
  type Concept,
  type GeneratedQuestion,
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
      type: z.literal("ordering"),
      items: z.array(z.string().min(1).max(300)).min(2).max(7),
      correctAnswer: z.array(z.number().int().nonnegative()).min(2).max(7),
    }).refine(
      (question) =>
        question.correctAnswer.length === question.items.length &&
        new Set(question.correctAnswer).size === question.items.length &&
        question.correctAnswer.every((index) => index < question.items.length),
      { message: "correctAnswer must be a permutation of item indexes" },
    ),
    QuestionDraftBaseSchema.extend({
      type: z.literal("short_answer"),
      rubric: z.object({
        requiredIdeas: z.array(z.string().min(1).max(300)).min(1).max(6),
        acceptableAlternatives: z.array(z.string().min(1).max(300)).max(10),
      }),
    }),
  ]),
});

const QuestionTypes = [
  "multiple_choice",
  "true_false",
  "ordering",
  "short_answer",
] as const;
type QuestionType = (typeof QuestionTypes)[number];

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
  let used = 0;
  const lines: string[] = [];
  for (const segment of segments) {
    const line = `[${segment.id}] ${segment.text.replaceAll("\n", " ").trim()}`;
    if (used + line.length > maximumCharacters) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export async function classifyTranscript(
  env: AppEnv,
  title: string,
  segments: TranscriptSegment[],
) {
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
          content: `Title: ${title}\n\nTranscript sample:\n${serializeTranscript(segments, 6_000)}`,
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
  },
): Promise<QuizGeneration> {
  const questionCount = questionLimitForSession(input.sessionLength);
  const generatedItems: Array<{
    concept: Concept;
    question: GeneratedQuestion;
  }> = [];
  for (let offset = 0; offset < questionCount; offset += 5) {
    const batch = Array.from(
      { length: Math.min(5, questionCount - offset) },
      (_, batchIndex) => {
        const index = offset + batchIndex;
        return generateQuizItem(env, input, index, questionCount);
      },
    );
    generatedItems.push(...(await Promise.all(batch)));
  }
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
  return generated;
}

async function generateQuizItem(
  env: AppEnv,
  input: {
    title: string;
    language: "en" | "zh-CN";
    sessionLength: "short" | "medium" | "long";
    watched: boolean;
    segments: TranscriptSegment[];
  },
  index: number,
  questionCount: number,
): Promise<{ concept: Concept; question: GeneratedQuestion }> {
  const questionType =
    QuestionTypes[index % QuestionTypes.length] ?? "multiple_choice";
  const evidence = selectEvidenceWindow(input.segments, index, questionCount);
  try {
    const draft = await requestJson(
      env,
      [
        {
          role: "system",
          content: `Create one concise evidence-grounded quiz item. Return JSON with concept {title, summary} and question. Question keys: type, prompt, explanation, difficulty (1-5), reformulatedPrompt. For multiple_choice add options and zero-based correctAnswer; for true_false add boolean correctAnswer; for ordering add items and a zero-based permutation correctAnswer; for short_answer add rubric {requiredIdeas, acceptableAlternatives}. Use only supplied evidence, keep explanations to one sentence, and use question type ${questionType}.`,
        },
        {
          role: "user",
          content: `Video: ${input.title}\nLanguage: ${input.language}\nQuestion type: ${questionType}\nEvidence:\n${serializeTranscript(evidence, 4_000)}`,
        },
      ],
      GeneratedQuizItemDraftSchema,
      {
        operation: `generate_question_${index + 1}`,
        maximumOutputTokens: 900,
        maximumAttempts: 1,
        timeoutMs: 7_500,
      },
    );
    if (draft.question.type !== questionType)
      throw new Error("DeepSeek returned the wrong question type");
    return materializeQuizItem(draft, evidence, index);
  } catch {
    logDeepSeek(
      "question.fallback",
      { questionIndex: index + 1, questionType },
      "warn",
    );
    return fallbackQuizItem(evidence, index, questionType, input.language);
  }
}

function selectEvidenceWindow(
  segments: TranscriptSegment[],
  index: number,
  questionCount: number,
): TranscriptSegment[] {
  const usable = segments.filter((segment) => segment.text.trim().length >= 12);
  const source = usable.length >= 12 ? usable : segments;
  const center = Math.floor(
    ((index + 1) / (questionCount + 1)) * source.length,
  );
  const start = Math.max(0, Math.min(source.length - 12, center - 6));
  return source.slice(start, start + 12);
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
  questionType: QuestionType,
  language: "en" | "zh-CN",
): { concept: Concept; question: GeneratedQuestion } {
  const conceptId = `concept-${index + 1}`;
  const evidenceSegmentIds = evidence.map((segment) => segment.id);
  const sourceStatements = evidence
    .slice(0, 3)
    .map((segment) => segment.text.trim().slice(0, 240));
  const focus = sourceStatements[0] ?? "the topic in this section";
  const statements =
    sourceStatements.length >= 2
      ? sourceStatements
      : [focus, `A related point: ${focus}`];
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
        : questionType === "ordering"
          ? {
              ...common,
              type: questionType,
              prompt:
                language === "zh-CN"
                  ? "按照视频中的出现顺序排列这些观点。"
                  : "Put these ideas in the order presented in the video.",
              items: statements,
              correctAnswer: statements.map((_, itemIndex) => itemIndex),
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
  origin: z.enum(["captions", "device_whisper"]),
  segments: z.array(TranscriptSegmentSchema).min(1),
});

export function questionStorageFields(question: GeneratedQuestion) {
  return {
    optionsJson:
      question.type === "multiple_choice"
        ? JSON.stringify(question.options)
        : null,
    itemsJson:
      question.type === "ordering" ? JSON.stringify(question.items) : null,
    correctAnswerJson:
      question.type === "short_answer"
        ? null
        : JSON.stringify(question.correctAnswer),
    rubricJson:
      question.type === "short_answer" ? JSON.stringify(question.rubric) : null,
  };
}
