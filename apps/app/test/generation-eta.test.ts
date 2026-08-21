import { describe, expect, it } from "vitest";
import {
  countCaptionWords,
  estimatedFirstQuestionDurationMs,
} from "../src/generation/eta";

describe("first-question ETA", () => {
  it.each([
    [839, 5, "multiple_choice", 15_668],
    [1_786, 5, "true_false", 15_000],
    [2_771, 5, "short_answer", 25_054],
    [11_851, 15, "short_answer", 30_870],
  ] as const)(
    "uses the calibrated factors for %i words, %i questions, and %s",
    (captionWordCount, questionCount, firstQuestionType, expectedMs) => {
      expect(
        estimatedFirstQuestionDurationMs({
          captionWordCount,
          questionCount,
          firstQuestionType,
        }),
      ).toBe(expectedMs);
    },
  );

  it("adds only a small planning adjustment for longer quizzes", () => {
    const estimates = [5, 10, 15].map((questionCount) =>
      estimatedFirstQuestionDurationMs({
        captionWordCount: 5_000,
        questionCount: questionCount as 5 | 10 | 15,
        firstQuestionType: "multiple_choice",
      }),
    );

    expect(estimates).toEqual([16_500, 18_500, 20_500]);
  });

  it("models the first emitted question type", () => {
    const common = { captionWordCount: 5_000, questionCount: 10 } as const;

    expect(
      estimatedFirstQuestionDurationMs({
        ...common,
        firstQuestionType: "true_false",
      }),
    ).toBe(15_000);
    expect(
      estimatedFirstQuestionDurationMs({
        ...common,
        firstQuestionType: "multiple_choice",
      }),
    ).toBe(18_500);
    expect(
      estimatedFirstQuestionDurationMs({
        ...common,
        firstQuestionType: "short_answer",
      }),
    ).toBe(27_500);
  });

  it("caps the word contribution at the largest calibrated transcript", () => {
    const calibrated = estimatedFirstQuestionDurationMs({
      captionWordCount: 12_000,
      questionCount: 10,
      firstQuestionType: "multiple_choice",
    });
    const muchLonger = estimatedFirstQuestionDurationMs({
      captionWordCount: 120_000,
      questionCount: 10,
      firstQuestionType: "multiple_choice",
    });

    expect(muchLonger).toBe(calibrated);
  });

  it("uses duration as a word-count fallback without overriding exact words", () => {
    expect(
      estimatedFirstQuestionDurationMs({
        videoDurationSeconds: 600,
        questionCount: 5,
        firstQuestionType: "multiple_choice",
      }),
    ).toBe(15_810);
    expect(
      estimatedFirstQuestionDurationMs({
        captionWordCount: 0,
        videoDurationSeconds: 600,
        questionCount: 5,
        firstQuestionType: "multiple_choice",
      }),
    ).toBe(15_500);
  });
});

describe("caption word counting", () => {
  it("counts punctuation and apostrophes as normal word boundaries", () => {
    expect(
      countCaptionWords([
        { text: "Hello, world! It's 2026." },
        { text: "Cats’ paws." },
      ]),
    ).toBe(6);
  });

  it("produces word-equivalents for unspaced CJK captions", () => {
    expect(countCaptionWords([{ text: "你好世界" }])).toBe(2);
    expect(countCaptionWords([{ text: "学習です" }])).toBe(2);
  });
});
