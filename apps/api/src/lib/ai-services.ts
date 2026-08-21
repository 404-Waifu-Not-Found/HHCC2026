import { type TranscriptSegment } from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "./errors";
import type { AppEnv } from "../types";

const WrittenGradeSchema = z
  .object({
    correct: z.boolean(),
    feedback: z.string().min(1).max(600),
  })
  .strict();

const HistoryClassificationSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            educational: z.boolean(),
            reason: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

async function requestJson<T>(
  env: AppEnv,
  messages: Array<{ role: "system" | "user"; content: string }>,
  schema: z.ZodType<T>,
  maximumOutputTokens: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
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
        messages,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        response_format: { type: "json_object" },
        max_tokens: maximumOutputTokens,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      503,
      "ai_service_unavailable",
      "The answer-grading service is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ApiError(
      503,
      "ai_service_unavailable",
      "The answer-grading service is temporarily unavailable.",
    );
  }
  const outer = z
    .object({
      choices: z
        .array(
          z.object({
            message: z.object({ content: z.string().min(1) }),
            finish_reason: z.string().nullable().optional(),
          }),
        )
        .min(1),
    })
    .safeParse(await response.json());
  if (!outer.success || outer.data.choices[0]?.finish_reason === "length") {
    throw new ApiError(
      502,
      "ai_service_invalid",
      "The answer-grading service returned an incomplete response.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(outer.data.choices[0]!.message.content);
  } catch {
    decoded = null;
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "ai_service_invalid",
      "The answer-grading service returned invalid JSON.",
    );
  }
  return parsed.data;
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
          'Grade using only the supplied rubric and, when present, the cited evidence. Some locally generated quizzes intentionally provide no stored transcript evidence; in that case, use only the rubric and acceptable alternatives. Accept equivalent wording. Do not add outside facts. Return valid JSON exactly like {"correct":true,"feedback":"..."}.',
      },
      {
        role: "user",
        content: JSON.stringify({
          question: input.prompt,
          learnerAnswer: input.answer,
          requiredIdeas: input.requiredIdeas,
          acceptableAlternatives: input.acceptableAlternatives,
          evidence: input.evidence,
        }),
      },
    ],
    WrittenGradeSchema,
    400,
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
          'Classify every supplied title for meaningful academic, technical, language, or practical learning. Return valid JSON exactly like {"candidates":[{"id":"...","educational":true,"reason":"..."}]}. Preserve every id.',
      },
      { role: "user", content: JSON.stringify({ candidates }) },
    ],
    HistoryClassificationSchema,
    2_000,
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
