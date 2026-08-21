import { describe, expect, it } from "vitest";
import {
  recordRecapEntry,
  summarizeRecap,
  type RecapEntry,
} from "../src/lib/session-recap";

function entry(overrides: Partial<RecapEntry> = {}): RecapEntry {
  return {
    questionId: "q1",
    prompt: "Why does retrieval practice strengthen memory?",
    correct: true,
    isRetry: false,
    explanation: "Reconstructing an idea strengthens the retrieval path.",
    ...overrides,
  };
}

describe("recordRecapEntry", () => {
  it("appends without mutating the previous list", () => {
    const first = recordRecapEntry([], entry());
    const second = recordRecapEntry(first, entry({ questionId: "q2" }));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
  });
});

describe("summarizeRecap", () => {
  it("reports an empty session", () => {
    expect(summarizeRecap([])).toEqual({
      answered: 0,
      firstTryCorrect: 0,
      missed: [],
    });
  });

  it("counts distinct questions and first-try correctness", () => {
    const summary = summarizeRecap([
      entry({ questionId: "q1", correct: true }),
      entry({ questionId: "q2", correct: false }),
      entry({ questionId: "q3", correct: true }),
    ]);
    expect(summary.answered).toBe(3);
    expect(summary.firstTryCorrect).toBe(2);
    expect(summary.missed.map((item) => item.questionId)).toEqual(["q2"]);
  });

  it("keeps the first miss per question in session order and marks retry recovery", () => {
    const summary = summarizeRecap([
      entry({ questionId: "q1", correct: false, learnerAnswer: "A" }),
      entry({ questionId: "q2", correct: true }),
      entry({
        questionId: "q1",
        correct: true,
        isRetry: true,
        prompt: "Try again: why does retrieval practice strengthen memory?",
      }),
      entry({ questionId: "q3", correct: false, learnerAnswer: "False" }),
      entry({ questionId: "q3", correct: false, isRetry: true }),
    ]);
    expect(summary.answered).toBe(3);
    expect(summary.firstTryCorrect).toBe(1);
    expect(summary.missed).toHaveLength(2);
    expect(summary.missed[0]).toMatchObject({
      questionId: "q1",
      learnerAnswer: "A",
      prompt: "Why does retrieval practice strengthen memory?",
      recoveredOnRetry: true,
    });
    expect(summary.missed[1]).toMatchObject({
      questionId: "q3",
      learnerAnswer: "False",
      recoveredOnRetry: false,
    });
  });

  it("does not count a retry as a first-try success", () => {
    const summary = summarizeRecap([
      entry({ questionId: "q1", correct: false }),
      entry({ questionId: "q1", correct: true, isRetry: true }),
    ]);
    expect(summary.answered).toBe(1);
    expect(summary.firstTryCorrect).toBe(0);
    expect(summary.missed[0]?.recoveredOnRetry).toBe(true);
  });

  it("preserves the correct answer and explanation of the missed attempt", () => {
    const summary = summarizeRecap([
      entry({
        questionId: "q1",
        correct: false,
        correctAnswer: "It requires the brain to reconstruct the idea",
        explanation: "Effortful reconstruction strengthens access later.",
      }),
    ]);
    expect(summary.missed[0]).toMatchObject({
      correctAnswer: "It requires the brain to reconstruct the idea",
      explanation: "Effortful reconstruction strengthens access later.",
    });
  });
});
