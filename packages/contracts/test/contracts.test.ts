import { describe, expect, it } from "vitest";
import {
  AdminMeResponseSchema,
  AdminSystemResponseSchema,
  ExtensionQuizImportRequestSchema,
  LocalConceptQuizResultSchema,
  QuizQuestionTypesSchema,
  identifyVideoSource,
  questionLimitForSession,
} from "../src/index";

describe("admin contracts", () => {
  it("rejects unknown roles and never models secret values", () => {
    expect(
      AdminMeResponseSchema.safeParse({
        user: {
          id: "u1",
          name: "Owner",
          email: "owner@example.com",
          role: "superuser",
        },
        permissions: [],
      }).success,
    ).toBe(false);
    expect(
      AdminSystemResponseSchema.parse({
        configuration: {
          authentication: true,
          generation: true,
          email: true,
          youtubeEncryption: true,
          youtubeDemoHistory: false,
        },
        model: "deepseek-v4-flash",
        jobs: { queued: 1, running: 2, complete: 3, failed: 4 },
        database: {
          migration: "0007_admin_audit_retention",
          auditEnabled: true,
        },
      }).configuration,
    ).toEqual({
      authentication: true,
      generation: true,
      email: true,
      youtubeEncryption: true,
      youtubeDemoHistory: false,
    });
  });
});

describe("video source validation", () => {
  it("recognizes supported hosts without accepting lookalikes", () => {
    expect(identifyVideoSource("https://youtu.be/abc")).toBe("youtube");
    expect(identifyVideoSource("https://www.bilibili.com/video/BV1xx")).toBe(
      "bilibili",
    );
    expect(
      identifyVideoSource("https://youtube.com.evil.example/video"),
    ).toBeNull();
  });
});

describe("session length", () => {
  it.each([
    ["short", 5],
    ["medium", 10],
    ["long", 15],
  ] as const)("maps %s to %i questions", (length, count) => {
    expect(questionLimitForSession(length)).toBe(count);
  });
});

describe("generated questions", () => {
  it("requires at least one unique supported question type", () => {
    expect(QuizQuestionTypesSchema.safeParse([]).success).toBe(false);
    expect(
      QuizQuestionTypesSchema.safeParse(["multiple_choice", "multiple_choice"])
        .success,
    ).toBe(false);
    expect(
      QuizQuestionTypesSchema.parse(["multiple_choice", "short_answer"]),
    ).toEqual(["multiple_choice", "short_answer"]);
  });

  it("accepts only a complete strict extension quiz with matching answers", () => {
    const quiz = localQuizResult(5);
    expect(LocalConceptQuizResultSchema.parse(quiz)).toEqual(quiz);
    expect(
      LocalConceptQuizResultSchema.safeParse({
        ...quiz,
        quiz: {
          ...quiz.quiz,
          questions: quiz.quiz.questions.map((question, index) =>
            index === 0
              ? { ...question, answer: question.choices[1] }
              : question,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      LocalConceptQuizResultSchema.safeParse({ ...quiz, unexpected: true })
        .success,
    ).toBe(false);
  });

  it("requires the local quiz count to match its session length", () => {
    expect(
      ExtensionQuizImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "medium",
        watched: true,
        quiz: localQuizResult(5),
      }).success,
    ).toBe(false);
    expect(
      ExtensionQuizImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "short",
        watched: true,
        quiz: localQuizResult(5),
      }).success,
    ).toBe(true);
  });
});

function localQuizResult(questionCount: 5 | 10 | 15) {
  return {
    protocolVersion: 2 as const,
    pipelineVersion: 6 as const,
    model: "deepseek-v4-flash" as const,
    reasoningEffort: "high" as const,
    promptVersion: "quiz-local-tool-v1.0" as const,
    validatorVersion: "validator-local-tool-v1.0" as const,
    quiz: {
      title: "A local concept quiz",
      questions: Array.from({ length: questionCount }, (_, index) => ({
        id: `q${index + 1}`,
        concept: `Concept ${index + 1}`,
        question: `How does concept ${index + 1} work?`,
        choices: [
          `Correct ${index + 1}`,
          `Distractor A ${index + 1}`,
          `Distractor B ${index + 1}`,
          `Distractor C ${index + 1}`,
        ] as [string, string, string, string],
        answerIndex: 0,
        answer: `Correct ${index + 1}`,
        explanation: `Concept ${index + 1} supports this answer.`,
      })),
    },
    metrics: {
      aiCalls: 1 as const,
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      elapsedMs: 1_000,
    },
  };
}
