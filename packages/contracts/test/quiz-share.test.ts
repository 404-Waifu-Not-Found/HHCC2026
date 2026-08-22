import { describe, expect, it } from "vitest";
import {
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
} from "../src/index";

const TOKEN = "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a";
const QUIZ_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

describe("quiz share contracts", () => {
  it("accepts a share link response", () => {
    expect(
      QuizShareResponseSchema.parse({
        token: TOKEN,
        url: `https://clipquest.ccwu.cc/s/${TOKEN}`,
      }),
    ).toEqual({ token: TOKEN, url: `https://clipquest.ccwu.cc/s/${TOKEN}` });
    expect(() =>
      QuizShareResponseSchema.parse({ token: "nope", url: "javascript:x" }),
    ).toThrow();
  });

  it("keeps the public preview free of question text", () => {
    const preview = QuizSharePreviewSchema.parse({
      token: TOKEN,
      title: "How memory really works",
      originalUrl: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
      thumbnailUrl: `https://clipquest.ccwu.cc/api/videos/${VIDEO_ID}/thumbnail`,
      sharedBy: "Avery Learner",
      language: "en",
      sessionLength: "short",
      questionCount: 5,
      questionTypes: ["multiple_choice", "short_answer"],
      concepts: ["Retrieval practice", "Spacing"],
    });
    expect(Object.keys(preview).sort()).toEqual([
      "concepts",
      "language",
      "originalUrl",
      "questionCount",
      "questionTypes",
      "sessionLength",
      "sharedBy",
      "thumbnailUrl",
      "title",
      "token",
    ]);
    expect(() =>
      QuizSharePreviewSchema.parse({
        ...preview,
        concepts: Array.from({ length: 13 }, (_, index) => `c${index}`),
      }),
    ).toThrow();
  });

  it("carries custom question counts in claim start settings", () => {
    expect(
      QuizShareClaimResponseSchema.parse({
        quizId: QUIZ_ID,
        videoId: VIDEO_ID,
        startSettings: {
          sessionLength: "custom",
          questionTypes: ["true_false"],
          questionCount: 7,
        },
      }).startSettings,
    ).toEqual({
      sessionLength: "custom",
      questionTypes: ["true_false"],
      questionCount: 7,
    });
    expect(
      QuizShareClaimResponseSchema.parse({
        quizId: QUIZ_ID,
        videoId: VIDEO_ID,
        startSettings: { sessionLength: "medium" },
      }).startSettings,
    ).toEqual({ sessionLength: "medium" });
  });
});
