import { describe, expect, it } from "vitest";
import { progressiveLibraryStartSettings } from "../src/routes/library";

function readySummary() {
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v3",
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    promptVersion: "quiz-local-json-stream-v5.1",
    validatorVersion: "validator-local-progressive-v4.0",
    generationState: "ready",
    requestedQuestionTypes: ["short_answer"],
    generatedQuestionTypes: Array.from({ length: 15 }, () => "short_answer"),
    plannedCount: 15,
    acceptedCount: 15,
    lastProgressAt: 1_700_000_000_000,
    acceptedQuestionSummaries: Array.from({ length: 15 }, (_, index) => ({
      id: `q${index + 1}`,
      type: "short_answer",
      concept: `Concept ${index + 1}`,
      question: `Question ${index + 1}?`,
    })),
    transcriptStored: false,
    aiCalls: 3,
    retryCount: 0,
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    elapsedMs: 10_000,
  };
}

describe("progressive Library replay settings", () => {
  it("returns the original question plan for a completed pipeline-9 bank", () => {
    expect(
      progressiveLibraryStartSettings({
        pipelineVersion: 9,
        sessionLength: "long",
        qualitySummaryJson: JSON.stringify(readySummary()),
      }),
    ).toEqual({
      sessionLength: "long",
      questionTypes: ["short_answer"],
    });
  });

  it("fails closed when the stored session length and plan disagree", () => {
    expect(
      progressiveLibraryStartSettings({
        pipelineVersion: 9,
        sessionLength: "medium",
        qualitySummaryJson: JSON.stringify(readySummary()),
      }),
    ).toBeNull();
  });
});
