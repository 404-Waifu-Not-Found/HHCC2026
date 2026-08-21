import { describe, expect, it } from "vitest";
import {
  attachLocalReason,
  parseRecapEntries,
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

  it("treats a session that resumes on a pending retry as answered but not first-try correct", () => {
    const summary = summarizeRecap([
      entry({ questionId: "q1", correct: true, isRetry: true }),
    ]);
    expect(summary.answered).toBe(1);
    expect(summary.firstTryCorrect).toBe(0);
    expect(summary.missed).toEqual([]);
  });

  it("preserves the correct answer, explanation, and reason of the missed attempt", () => {
    const summary = summarizeRecap([
      entry({
        questionId: "q1",
        correct: false,
        correctAnswer: "It requires the brain to reconstruct the idea",
        explanation: "Effortful reconstruction strengthens access later.",
        reason: "Shorter videos do not change how memory is encoded.",
      }),
    ]);
    expect(summary.missed[0]).toMatchObject({
      correctAnswer: "It requires the brain to reconstruct the idea",
      explanation: "Effortful reconstruction strengthens access later.",
      reason: "Shorter videos do not change how memory is encoded.",
    });
  });
});

describe("attachLocalReason", () => {
  const entries = [
    entry({ questionId: "q1", correct: false }),
    entry({ questionId: "q2", correct: true }),
    entry({ questionId: "q1", correct: true, isRetry: true }),
  ];

  it("attaches the reason to the matching entry when the verdicts agree", () => {
    const next = attachLocalReason(
      entries,
      { questionId: "q1", isRetry: false },
      {
        correct: false,
        reason: "The answer names a side effect, not the cause.",
      },
    );
    expect(next[0]?.reason).toBe(
      "The answer names a side effect, not the cause.",
    );
    expect(next[2]?.reason).toBeUndefined();
    expect(entries[0]?.reason).toBeUndefined();
  });

  it("targets the retry entry separately from the first attempt", () => {
    const next = attachLocalReason(
      entries,
      { questionId: "q1", isRetry: true },
      { correct: true, reason: "Correct: recall rebuilds the idea." },
    );
    expect(next[0]?.reason).toBeUndefined();
    expect(next[2]?.reason).toBe("Correct: recall rebuilds the idea.");
  });

  it("ignores a local grade that disagrees with the server or is empty", () => {
    expect(
      attachLocalReason(
        entries,
        { questionId: "q1", isRetry: false },
        { correct: true, reason: "Looks right to me." },
      )[0]?.reason,
    ).toBeUndefined();
    expect(
      attachLocalReason(
        entries,
        { questionId: "q1", isRetry: false },
        { correct: false, reason: "   " },
      )[0]?.reason,
    ).toBeUndefined();
    expect(
      attachLocalReason(
        entries,
        { questionId: "q9", isRetry: false },
        { correct: false, reason: "No such question." },
      ),
    ).toEqual(entries);
  });
});

describe("parseRecapEntries", () => {
  it("round-trips valid entries and drops malformed ones", () => {
    const valid = entry({
      questionId: "q1",
      correct: false,
      learnerAnswer: "A",
      correctAnswer: "B",
      reason: "Because B.",
    });
    const restored = parseRecapEntries(
      JSON.parse(
        JSON.stringify([
          valid,
          { questionId: "q2", prompt: "missing fields" },
          "not an object",
          null,
          { ...entry({ questionId: "q3" }), learnerAnswer: 42 },
        ]),
      ),
    );
    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual(valid);
    expect(restored[1]).toMatchObject({
      questionId: "q3",
      learnerAnswer: undefined,
    });
  });

  it("returns an empty list for non-array input", () => {
    expect(parseRecapEntries(undefined)).toEqual([]);
    expect(parseRecapEntries({ entries: [] })).toEqual([]);
  });
});
