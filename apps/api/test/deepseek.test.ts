import type { TranscriptSegment } from "@clipquest/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyTranscript,
  generateQuiz,
  selectEvidenceWindow,
  serializeFullSubtitles,
} from "../src/generation/deepseek";
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
  it("sends every subtitle segment to educational classification", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        const prompt = body.messages.at(-1)?.content ?? "";
        expect(segments.every((segment) => prompt.includes(segment.text))).toBe(
          true,
        );
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    educational: true,
                    reason: "The complete lesson is instructional.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      classifyTranscript(env, "Primitive Types", segments),
    ).resolves.toMatchObject({ educational: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
        const questionTypes = [
          ...prompt.matchAll(/Required question type: ([a-z_]+)/g),
        ].map((match) => match[1] ?? "multiple_choice");
        await released;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: questionTypes.map((type) => draftFor(type)),
                  }),
                },
              },
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
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    releaseRequests?.();
    const generation = await generationPromise;

    expect(generation.questions).toHaveLength(15);
    const generationPrompts = fetchMock.mock.calls.map((call) => {
      const body = JSON.parse(String(call[1]?.body)) as {
        messages: Array<{ content: string }>;
      };
      return body.messages.at(-1)?.content ?? "";
    });
    expect(
      generationPrompts.every((prompt) =>
        segments.every((segment) => prompt.includes(segment.text)),
      ),
    ).toBe(true);
    expect(
      generation.questions.slice(0, 3).map((question) => question.type),
    ).toEqual(["multiple_choice", "true_false", "short_answer"]);
    expect(
      generation.questions.some(
        (question) => String(question.type) === "ordering",
      ),
    ).toBe(false);
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
      questionTypes: ["short_answer"],
    });

    expect(generation.questions).toHaveLength(5);
    expect(
      generation.questions.every(
        (question) => question.evidenceSegmentIds.length > 0,
      ),
    ).toBe(true);
  });

  it("partitions the complete transcript across the generated question bank", () => {
    const covered = new Set(
      Array.from({ length: 15 }, (_, index) =>
        selectEvidenceWindow(segments, index, 15),
      )
        .flat()
        .map((segment) => segment.id),
    );

    expect(covered).toEqual(new Set(segments.map((segment) => segment.id)));
    expect(selectEvidenceWindow(segments, 0, 15).at(0)?.id).toBe("segment-1");
    expect(selectEvidenceWindow(segments, 14, 15).at(-1)?.id).toBe(
      "segment-80",
    );
  });

  it("serializes every subtitle segment without sampling or truncation", () => {
    const serialized = serializeFullSubtitles(segments);

    expect(serialized.split("\n")).toHaveLength(segments.length);
    expect(serialized).toBe(
      segments
        .map(
          (segment, index) =>
            `[${index + 1}|${segment.id}|${segment.startMs}-${segment.endMs}] ${segment.text}`,
        )
        .join("\n"),
    );
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
