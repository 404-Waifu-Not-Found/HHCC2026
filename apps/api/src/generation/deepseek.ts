import {
  QuizGenerationSchema,
  TranscriptSegmentSchema,
  type GeneratedQuestion,
  type QuizGeneration,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import type { AppEnv } from "../types";

const DeepSeekResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().min(1) }),
    }),
  ).min(1),
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

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

async function requestJson<T>(env: AppEnv, messages: DeepSeekMessage[], schema: z.ZodType<T>): Promise<T> {
  let validationFeedback = "";
  let lastError = "No response";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.25,
        messages: [
          ...messages,
          ...(validationFeedback
            ? [{ role: "user" as const, content: `Your previous JSON was invalid. Fix only these issues and return a complete JSON object:\n${validationFeedback}` }]
            : []),
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      lastError = `DeepSeek returned ${response.status}`;
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    const envelope = DeepSeekResponseSchema.safeParse(await response.json());
    if (!envelope.success) {
      lastError = "DeepSeek returned an empty response";
      validationFeedback = envelope.error.message.slice(0, 1_500);
      continue;
    }
    try {
      const firstChoice = envelope.data.choices.at(0);
      if (!firstChoice) throw new Error("DeepSeek returned no choices");
      const content = firstChoice.message.content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
      const parsed = schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
      lastError = "DeepSeek returned invalid structured output";
      validationFeedback = parsed.error.message.slice(0, 2_000);
    } catch (error) {
      lastError = "DeepSeek returned malformed JSON";
      validationFeedback = error instanceof Error ? error.message.slice(0, 1_500) : lastError;
    }
  }
  throw new ApiError(502, "deepseek_invalid_output", lastError);
}

function serializeTranscript(segments: TranscriptSegment[], maximumCharacters = 500_000): string {
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

export async function classifyTranscript(env: AppEnv, title: string, segments: TranscriptSegment[]) {
  return requestJson(
    env,
    [
      {
        role: "system",
        content:
          "You classify whether a video meaningfully teaches knowledge or a skill to learners aged 13+. Return strict JSON with educational (boolean) and reason. Entertainment with incidental facts is not educational.",
      },
      {
        role: "user",
        content: `Title: ${title}\n\nTranscript sample:\n${serializeTranscript(segments, 45_000)}`,
      },
    ],
    EducationClassificationSchema,
  );
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
  const transcript = serializeTranscript(input.segments);
  const generated = await requestJson(
    env,
    [
      {
        role: "system",
        content: `You create evidence-grounded ClipQuest quizzes. Return one JSON object only.
Required keys: educational=true, classificationReason, sourceLanguage, primer, concepts, questions.
Each concept: id, title, summary, evidenceSegmentIds.
Each question: id, conceptId, type, prompt, explanation, evidenceSegmentIds, difficulty (1-5), reformulatedPrompt.
Question types and extra fields:
- multiple_choice: options (2-6 strings), correctAnswer (zero-based option index)
- true_false: correctAnswer (boolean)
- ordering: items and correctAnswer (permutation of zero-based indexes)
- short_answer: rubric with requiredIdeas and acceptableAlternatives
Use a varied mix. Every claim and every question must be answerable from its cited transcript segment IDs. Explanations must be one or two short sentences. The reformulated prompt must test the same concept in a different way without revealing the answer. Do not use outside knowledge. The primer must be a short video-only orientation, not a generic lesson.`,
      },
      {
        role: "user",
        content: `Video title: ${input.title}
Quiz language: ${input.language}
Session target: ${input.sessionLength}
Learner already watched: ${input.watched ? "yes" : "no"}
Create 18 questions so adaptive short, medium, and long sessions have variety. Use only these transcript segments:\n${transcript}`,
      },
    ],
    QuizGenerationSchema,
  );
  validateEvidence(generated, input.segments);
  return generated;
}

function validateEvidence(generation: QuizGeneration, segments: TranscriptSegment[]): void {
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const conceptIds = new Set(generation.concepts.map((concept) => concept.id));
  for (const concept of generation.concepts) {
    if (concept.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
      throw new ApiError(502, "ungrounded_generation", "A generated concept cited transcript evidence that does not exist.");
    }
  }
  for (const question of generation.questions) {
    if (!conceptIds.has(question.conceptId) || question.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
      throw new ApiError(502, "ungrounded_generation", "A generated question was not grounded in the video transcript.");
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
  );
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  return new Map(
    result.candidates
      .filter((candidate) => candidate.educational && allowedIds.has(candidate.id))
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
    optionsJson: question.type === "multiple_choice" ? JSON.stringify(question.options) : null,
    itemsJson: question.type === "ordering" ? JSON.stringify(question.items) : null,
    correctAnswerJson:
      question.type === "short_answer" ? null : JSON.stringify(question.correctAnswer),
    rubricJson: question.type === "short_answer" ? JSON.stringify(question.rubric) : null,
  };
}
