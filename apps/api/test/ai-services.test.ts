import { afterEach, describe, expect, it, vi } from "vitest";
import { gradeShortAnswerWithAi } from "../src/lib/ai-services";
import type { AppEnv } from "../src/types";

const env = {
  DEEPSEEK_API_KEY: "test-key",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
} as AppEnv;

afterEach(() => vi.unstubAllGlobals());

describe("gradeShortAnswerWithAi", () => {
  it("sends the question, sample answer, learner answer, and rubric to DeepSeek", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"correct":true}' } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gradeShortAnswerWithAi(env, {
        question: "What does chlorophyll absorb?",
        sampleAnswer: "Light energy.",
        learnerAnswer: "It absorbs light.",
        requiredIdeas: ["Chlorophyll absorbs light energy"],
        acceptableAlternatives: ["It absorbs light."],
        rubricV2: {
          version: 2,
          mode: "atomic_term",
          canonicalAnswer: "Light energy.",
          aliases: ["light"],
        },
      }),
    ).resolves.toBe(true);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      model: string;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    const payload = JSON.parse(body.messages[1]!.content) as {
      question: string;
      sampleAnswer: string;
      learnerAnswer: string;
      rubric: { requiredIdeas: string[]; acceptableAlternatives: string[] };
    };

    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
    });
    expect(body.messages[0]?.content).toContain("untrusted data");
    expect(payload).toMatchObject({
      question: "What does chlorophyll absorb?",
      sampleAnswer: "Light energy.",
      learnerAnswer: "It absorbs light.",
      rubric: {
        requiredIdeas: ["Chlorophyll absorbs light energy"],
        acceptableAlternatives: ["It absorbs light."],
      },
    });
  });
});