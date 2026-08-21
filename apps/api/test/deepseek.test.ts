import type { TranscriptSegment } from "@clipquest/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateQuiz } from "../src/generation/deepseek";
import type { AppEnv } from "../src/types";

const env = {
  DEEPSEEK_API_KEY: "test-key",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
} as AppEnv;

const segments: TranscriptSegment[] = Array.from(
  { length: 80 },
  (_, index) => ({
    id: `segment-${index + 1}`,
    startMs: index * 1_000,
    endMs: (index + 1) * 1_000,
    text: `The lesson explains concept ${index + 1} with enough detail for a grounded learning question.`,
  }),
);

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeepSeek quiz generation", () => {
  it("starts every five-question batch concurrently", async () => {
    let releaseRequests: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        const prompt = body.messages.at(-1)?.content ?? "";
        const questionType =
          prompt.match(/Question type: ([a-z_]+)/)?.[1] ?? "multiple_choice";
        await released;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(draftFor(questionType)) } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const generationPromise = generateQuiz(env, {
      title: "Primitive Types",
      language: "en",
      sessionLength: "long",
      watched: true,
      segments,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(15));
    releaseRequests?.();
    const generation = await generationPromise;

    expect(generation.questions).toHaveLength(15);
    expect(
      generation.questions.slice(0, 4).map((question) => question.type),
    ).toEqual(["multiple_choice", "true_false", "ordering", "short_answer"]);
  });

  it("falls back to grounded local questions when model JSON is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ invalid: true }) } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const generation = await generateQuiz(env, {
      title: "Primitive Types",
      language: "en",
      sessionLength: "short",
      watched: true,
      segments,
    });

    expect(generation.questions).toHaveLength(5);
    expect(
      generation.questions.every(
        (question) => question.evidenceSegmentIds.length > 0,
      ),
    ).toBe(true);
  });
});

function draftFor(questionType: string) {
  const common = {
    prompt: "What does this lesson explain?",
    explanation: "The cited segment directly explains the answer.",
    difficulty: 2,
    reformulatedPrompt: "How would you restate the lesson's key idea?",
  };
  const question =
    questionType === "true_false"
      ? { ...common, type: "true_false", correctAnswer: true }
      : questionType === "ordering"
        ? {
            ...common,
            type: "ordering",
            items: ["First idea", "Second idea"],
            correctAnswer: [0, 1],
          }
        : questionType === "short_answer"
          ? {
              ...common,
              type: "short_answer",
              rubric: {
                requiredIdeas: ["The key idea"],
                acceptableAlternatives: [],
              },
            }
          : {
              ...common,
              type: "multiple_choice",
              options: ["Correct", "Incorrect"],
              correctAnswer: 0,
            };
  return {
    concept: {
      title: "Key idea",
      summary: "A concise explanation of the lesson's key idea.",
    },
    question,
  };
}
