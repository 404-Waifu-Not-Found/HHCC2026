import { describe, expect, it } from "vitest";
import {
  AdminMeResponseSchema,
  AdminSystemResponseSchema,
  ExtensionQuizImportRequestSchema,
  LocalConceptQuizResultSchema,
  QuizQuestionTypesSchema,
  identifyVideoSource,
  questionLimitForSession,
  questionTypePlanForSelection,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizResult,
  type QuizQuestionType,
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
            index === 0 && question.type === "multiple_choice"
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
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        watched: true,
        quiz: localQuizResult(5),
      }).success,
    ).toBe(false);
    expect(
      ExtensionQuizImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "short",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        watched: true,
        quiz: localQuizResult(5),
      }).success,
    ).toBe(true);
  });

  it("rejects a generated type sequence that does not match the request", () => {
    const quiz = localQuizResult(5);
    expect(
      ExtensionQuizImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "short",
        questionTypes: ["multiple_choice"],
        watched: true,
        quiz,
      }).success,
    ).toBe(false);
  });
});

function localQuizResult(questionCount: 5 | 10 | 15): LocalConceptQuizResult {
  const questionTypes: QuizQuestionType[] = [
    "multiple_choice",
    "true_false",
    "short_answer",
  ];
  const typePlan = questionTypePlanForSelection(questionTypes, questionCount);
  return {
    protocolVersion: 3,
    pipelineVersion: 7,
    model: "deepseek-v4-flash" as const,
    reasoningEffort: "high" as const,
    promptVersion: "quiz-local-tool-v2.0" as const,
    validatorVersion: "validator-local-tool-v2.0" as const,
    quiz: {
      title: "A local concept quiz",
      questions: typePlan.map((type, index) => localQuestion(type, index)),
    },
    metrics: {
      aiCalls: 1,
      retryCount: 0,
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      elapsedMs: 1_000,
    },
  };
}

function localQuestion(
  type: QuizQuestionType,
  index: number,
): LocalConceptQuizQuestion {
  const common = {
    id: `q${index + 1}`,
    concept: `Concept ${index + 1}`,
    question: `How does concept ${index + 1} work?`,
    explanation: `Concept ${index + 1} supports this answer.`,
  };
  if (type === "multiple_choice") {
    return {
      ...common,
      type,
      choices: [
        `Correct ${index + 1}`,
        `Distractor A ${index + 1}`,
        `Distractor B ${index + 1}`,
        `Distractor C ${index + 1}`,
      ],
      answerIndex: 0,
      answer: `Correct ${index + 1}`,
    };
  }
  if (type === "true_false") {
    return {
      ...common,
      type,
      answer: index % 2 === 0,
      correction: "The statement is accurate or corrected here.",
    };
  }
  return {
    ...common,
    type,
    answer: `Complete answer ${index + 1}`,
    rubricIdeas: [`Required idea ${index + 1}`],
    acceptableAnswers: [`Equivalent answer ${index + 1}`],
  };
}
