import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProgressiveQuizSummarySchema,
  generationAvailability,
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
