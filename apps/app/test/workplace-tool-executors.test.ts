import { describe, expect, it } from "vitest";
import type {
  CheatSheetDocument,
  TranscriptSegment,
} from "@clipquest/contracts";
import { runWorkplaceChatTurn } from "@clipquest/local-quiz-engine";
import {
  createWorkplaceToolExecutors,
  type WorkplaceToolServices,
} from "../src/workplace/tool-executors";

const VIDEO_A = "11111111-1111-4111-8111-111111111111";

function segment(id: string, startMs: number, text: string): TranscriptSegment {
  return { id, startMs, endMs: startMs + 2000, text };
}

const notesDocument: CheatSheetDocument = {
  title: "Neural network notes",
  source: "youtube",
  summary: "A neuron computes a weighted sum then applies an activation.",
  keyConcepts: ["Weighted sum", "Activation function", "Backpropagation"],
  definitions: [
    { term: "Weight", definition: "A learned multiplier on an input." },
  ],
  formulas: ["y = wx + b"],
  rememberThis: ["Gradients flow backward through the network."],
  generatedAt: new Date().toISOString(),
  sourceRevision: `${VIDEO_A}:library`,
};

function makeServices(
  overrides: Partial<WorkplaceToolServices> = {},
): WorkplaceToolServices {
  return {
    searchLibrary: async () => [
      {
        videoId: VIDEO_A,
        title: "Neural networks",
        source: "youtube",
        mastery: "intermediate",
        dueForReview: false,
        bestScore: 80,
        quizId: null,
      },
    ],
    loadCaptions: async () => ({
      title: "Neural networks",
      transcriptComplete: true,
      segments: [
        segment("s1", 0, "A neuron takes several weighted inputs."),
        segment("s2", 2000, "The activation function adds nonlinearity."),
        segment("s3", 4000, "Backpropagation adjusts the weights."),
        segment("s4", 6000, "Unrelated closing remarks about the channel."),
      ],
    }),
    loadNotes: async () => ({
      title: "Neural network notes",
      document: notesDocument,
    }),
    generatePracticeSet: async ({ videoIds }) => ({
      questions: [1, 2, 3, 4, 5].map((index) => ({
        id: `q${index}`,
        type: "multiple_choice" as const,
        concept: `Concept ${index}`,
        question: `What is ${index} + 1?`,
        explanation: `Because arithmetic ${index}.`,
        choices: [`A${index}`, `B${index}`, `C${index}`, `D${index}`],
        answerIndex: 0,
        answer: `A${index}`,
      })),
      videoIds,
      transcriptComplete: true,
      citations: [
        {
          videoId: VIDEO_A,
          title: "Neural networks",
          startMs: 0,
          endMs: 2000,
          quote: "weighted inputs",
        },
      ],
    }),
    ...overrides,
  };
}

describe("createWorkplaceToolExecutors", () => {
  it("returns bounded, query-matched caption excerpts and never the raw segments", async () => {
    const tools = createWorkplaceToolExecutors(makeServices());
    const ctx = { recentVideoIds: [] };
    const result = await tools.readVideoCaptions!(
      { videoId: VIDEO_A, query: "activation backpropagation", maxExcerpts: 2 },
      ctx,
    );
    expect(result.excerpts.length).toBe(2);
    expect(result.transcriptComplete).toBe(true);
    // Chronological order preserved.
    expect(result.excerpts[0]!.startMs).toBeLessThan(
      result.excerpts[1]!.startMs,
    );
    // Bounded and grounded to the requested video.
    for (const excerpt of result.excerpts) {
      expect(excerpt.videoId).toBe(VIDEO_A);
      expect(excerpt.quote.length).toBeLessThanOrEqual(320);
    }
    // The unrelated segment is filtered out.
    expect(
      result.excerpts.some((excerpt) => excerpt.quote.includes("channel")),
    ).toBe(false);
  });

  it("caps caption excerpts at the source-read excerpt ceiling", async () => {
    const tools = createWorkplaceToolExecutors(makeServices());
    const result = await tools.readVideoCaptions!(
      { videoId: VIDEO_A, query: "", maxExcerpts: 99 },
      { recentVideoIds: [] },
    );
    expect(result.excerpts.length).toBeLessThanOrEqual(5);
  });

  it("reads bounded note excerpts without transcript completeness", async () => {
    const tools = createWorkplaceToolExecutors(makeServices());
    const result = await tools.readPdfNotes!(
      { videoId: VIDEO_A, query: "activation" },
      { recentVideoIds: [] },
    );
    expect(result.transcriptComplete).toBe(false);
    expect(result.excerpts.length).toBeGreaterThan(0);
    expect(
      result.excerpts.some((excerpt) =>
        excerpt.quote.toLowerCase().includes("activation"),
      ),
    ).toBe(true);
  });

  it("returns an empty read when a source is unavailable", async () => {
    const tools = createWorkplaceToolExecutors(
      makeServices({ loadCaptions: async () => null }),
    );
    const result = await tools.readVideoCaptions!(
      { videoId: VIDEO_A },
      { recentVideoIds: [] },
    );
    expect(result.excerpts).toEqual([]);
    expect(result.transcriptComplete).toBe(false);
  });

  it("composes with the orchestrator to run a grounded practice turn", async () => {
    const tools = createWorkplaceToolExecutors(makeServices());
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      void init;
      const message =
        round === 0
          ? {
              content: "",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "create_practice_set",
                    arguments: JSON.stringify({
                      videoIds: [VIDEO_A],
                      requestedPolicy: "diagnostic",
                    }),
                  },
                },
              ],
            }
          : { content: "Here is your diagnostic.", tool_calls: [] };
      round += 1;
      return new Response(JSON.stringify({ choices: [{ message }] }), {
        status: 200,
      });
    }) as unknown as typeof globalThis.fetch;

    const result = await runWorkplaceChatTurn({
      apiKey: "sk-test-key-0123456789abcdef",
      userText: "Give me a diagnostic on neural networks",
      tools,
      adapters: { fetch: fetchImpl },
    });

    expect(result.practiceSet).not.toBeNull();
    expect(result.practiceSet!.questions.length).toBe(5);
    // A single complete video keeps the diagnostic policy.
    expect(result.practiceSet!.effectivePolicy).toBe("diagnostic");
  });
});
