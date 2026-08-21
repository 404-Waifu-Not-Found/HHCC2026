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
          choices: [
            {
              message: {
                content: "The response captures the required concept.",
                tool_calls: [
                  {
                    function: {
                      name: "grade_answer",
                      arguments: JSON.stringify({ is_correct: true }),
                    },
                  },
                ],
              },
            },
          ],
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
    ).resolves.toEqual({
      correct: true,
      reason: "The response captures the required concept.",
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      model: string;
      tools: { type: string }[];
      tool_choice: { type: string; function: { name: string } };
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
      tools: [{ type: "function" }],
      tool_choice: { type: "function", function: { name: "grade_answer" } },
    });
    expect(body.messages[0]?.content).toContain("untrusted data");
    expect(body.messages[0]?.content).toContain("incidental qualifiers");
    expect(body.messages[0]?.content).toContain(
      "central relationship correctly and supports it with at least one relevant fact",
    );
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

  it("lets DeepSeek reason from the validated rubric when no sample exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "The answer identifies the required concept.",
                tool_calls: [
                  {
                    function: {
                      name: "grade_answer",
                      arguments: JSON.stringify({ is_correct: true }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gradeShortAnswerWithAi(env, {
        question: "What does chlorophyll absorb?",
        learnerAnswer: "It absorbs light.",
        requiredIdeas: ["Chlorophyll absorbs light energy"],
        acceptableAlternatives: ["It absorbs light."],
      }),
    ).resolves.toEqual({
      correct: true,
      reason: "The answer identifies the required concept.",
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      messages: { role: string; content: string }[];
    };
    const payload = JSON.parse(body.messages[1]!.content) as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("sampleAnswer");
    expect(body.messages[0]?.content).toContain(
      "Do not invent a missing reference answer",
    );
    expect(body.messages[0]?.content).toContain("First write one concise");
  });

  it("requests a second AI-only reason when the tool turn has no assistant text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      function: {
                        name: "grade_answer",
                        arguments: JSON.stringify({ is_correct: true }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "It communicates the required mechanism in a concise paraphrase.",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gradeShortAnswerWithAi(env, {
        question: "What does chlorophyll absorb?",
        learnerAnswer: "It absorbs light.",
        requiredIdeas: ["Chlorophyll absorbs light energy"],
        acceptableAlternatives: ["It absorbs light."],
      }),
    ).resolves.toEqual({
      correct: true,
      reason: "It communicates the required mechanism in a concise paraphrase.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      tools?: unknown;
      messages: { role: string; content: string }[];
    };
    expect(body.tools).toBeUndefined();
    expect(body.messages[0]?.content).toContain("answer-feedback writer");
  });

  it("retries a malformed DeepSeek tool response before failing closed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Reason only" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Still no tool" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "The concise answer communicates the required idea.",
                  tool_calls: [
                    {
                      function: {
                        name: "grade_answer",
                        arguments: JSON.stringify({ is_correct: true }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gradeShortAnswerWithAi(env, {
        question: "What does chlorophyll absorb?",
        learnerAnswer: "It absorbs light.",
        requiredIdeas: ["chlorophyll absorbs light energy"],
        acceptableAlternatives: ["light"],
      }),
    ).resolves.toEqual({
      correct: true,
      reason: "The concise answer communicates the required idea.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
