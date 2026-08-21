import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProgressiveQuizSummarySchema,
  generationAvailability,
  gradeProgressiveShortAnswer,
  parseProgressiveQuizSummary,
  tryProgressiveQuizSummary,
} from "../src/lib/progressive-quiz";

const questionTypes = [
  "multiple_choice",
  "true_false",
  "short_answer",
] as const;

function summary(count = 2) {
  const types = Array.from(
    { length: count },
    (_, index) => questionTypes[index % questionTypes.length]!,
  );
  return {
    source: "extension-local-json-stream" as const,
    importVersion: "extension-progressive-import-v3" as const,
    pipelineVersion: 9 as const,
    model: "deepseek-v4-flash" as const,
    reasoningEffort: "high" as const,
    promptVersion: "quiz-local-json-stream-v5.0" as const,
    validatorVersion: "validator-local-progressive-v4.0" as const,
    generationState: (count === 5 ? "ready" : "generating") as
      "ready" | "generating",
    requestedQuestionTypes: [...questionTypes],
    generatedQuestionTypes: types,
    plannedCount: 5 as const,
    acceptedCount: count,
    lastProgressAt: 1_786_000_000_000,
    acceptedQuestionSummaries: types.map((type, index) => ({
      id: `q${index + 1}`,
      type,
      concept: `Concept ${index + 1}`,
      question: `How does concept ${index + 1} work?`,
    })),
    transcriptStored: false as const,
    aiCalls: 1,
    retryCount: 0,
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    elapsedMs: 1_000,
  };
}

describe("progressive quiz storage state", () => {
  it("derives availability only from agreeing typed and authoritative state", () => {
    const parsed = ProgressiveQuizSummarySchema.parse(summary());
    expect(generationAvailability(parsed, "generating", 2)).toEqual({
      state: "generating",
      availableQuestions: 2,
      totalQuestions: 5,
    });
    expect(() => generationAvailability(parsed, "generating", 3)).toThrow(
      "Stored question counts do not match generation state.",
    );

    const complete = ProgressiveQuizSummarySchema.parse(summary(5));
    expect(generationAvailability(complete, "passed", 5)).toEqual({
      state: "ready",
      availableQuestions: 5,
      totalQuestions: 5,
    });
    expect(() => generationAvailability(complete, "generating", 5)).toThrow(
      "Quiz quality and generation state do not agree.",
    );
  });

  it("fails closed on prototype versions, plan drift, and sensitive extras", () => {
    const current = summary();
    expect(tryProgressiveQuizSummary(JSON.stringify(current))).not.toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({ ...current, pipelineVersion: 8 }),
      ),
    ).toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({
          ...current,
          acceptedQuestionSummaries: current.acceptedQuestionSummaries.map(
            (question, index) =>
              index === 1 ? { ...question, type: "short_answer" } : question,
          ),
        }),
      ),
    ).toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({
          ...current,
          apiKey: "never-store-this",
          transcript: "never-store-this-either",
          deepSeekResponseBody: "also-forbidden",
        }),
      ),
    ).toBeNull();
    expect(() => parseProgressiveQuizSummary("not json")).toThrow(
      "This quiz does not support current progressive question delivery.",
    );
  });

  it("adds pipeline-9 indexes without dropping the pipeline-7 index", () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../migrations/0016_progressive_quiz_streaming.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("quiz_banks_passed_v9_idx");
    expect(migration).toContain("quiz_banks_generating_v9_idx");
    expect(migration).toContain("pipeline_version = 9");
    expect(migration).not.toMatch(/DROP\s+INDEX/i);
    expect(migration).not.toMatch(/pipeline_version\s*=\s*8/i);
  });
});

describe("progressive short-answer grading", () => {
  const areaDerivativeRubric = {
    requiredIdeas: [
      "dA/dx is the ratio of a tiny change in area to a tiny change in x",
      "As dx gets smaller, the ratio approaches the height of the graph at that point",
      "For the x² graph, that height is x²",
    ],
    acceptableAlternatives: [
      "dA/dx is the derivative of A; it is the limit of the change in area divided by the change in x, equal to the value of x² at that point.",
    ],
  };

  it("accepts equivalent learner wording without a Worker-side model call", () => {
    expect(
      gradeProgressiveShortAnswer({
        answer:
          "It is the rate of change dA/dx, the added area divided by dx; as dx approaches zero it approaches x², the graph's height at x.",
        ...areaDerivativeRubric,
      }),
    ).toBe(true);
  });

  it("rejects answers that mention only one idea", () => {
    expect(
      gradeProgressiveShortAnswer({
        answer: "It is a derivative.",
        ...areaDerivativeRubric,
      }),
    ).toBe(false);
  });

  it("normalizes Chinese rubric wording without accepting a lone keyword", () => {
    const rubric = {
      requiredIdeas: ["它被称为积分", "这个函数表示从0到x的x²曲线下面积"],
      acceptableAlternatives: ["x²从0到x的积分，也就是曲线下的面积"],
    };
    expect(
      gradeProgressiveShortAnswer({
        answer: "这是 x² 从 0 到 x 的积分，也就是曲线下的面积。",
        ...rubric,
      }),
    ).toBe(true);
    expect(gradeProgressiveShortAnswer({ answer: "积分", ...rubric })).toBe(
      false,
    );
  });
});
