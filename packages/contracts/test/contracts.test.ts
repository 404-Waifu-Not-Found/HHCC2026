import { describe, expect, it } from "vitest";
import {
  AdminGenerationSchema,
  AdminGenerationsResponseSchema,
  AdminMeResponseSchema,
  AdminSystemResponseSchema,
  AttemptGenerationAvailabilitySchema,
  AttemptGenerationResponseSchema,
  ExtensionQuizImportRequestSchema,
  ExtensionQuizProgressiveImportRequestSchema,
  LocalConceptQuizChunkSchema,
  LocalConceptQuizResultSchema,
  LocalQuizContextSchema,
  QuizQuestionTypesSchema,
  identifyVideoSource,
  questionLimitForSession,
  questionTypePlanForSelection,
  type LocalConceptQuizQuestion,
  type LocalConceptQuizChunk,
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
          migration: "0016_progressive_quiz_streaming.sql",
          auditEnabled: true,
        },
        generation: {
          mode: "extension_local",
          backendEnabled: false,
          extensionEnabled: true,
          extensionRequired: true,
          model: "deepseek-v4-flash",
          pipelineVersion: 9,
          promptVersion: "quiz-local-json-stream-v5.1",
          validatorVersion: "validator-local-progressive-v4.0",
          states: {
            generating: 1,
            retrying: 2,
            retryRequired: 3,
            ready: 4,
          },
        },
        worker: {
          versionId: "873e0843-ab3b-4a2a-9d0d-4581dcceb810",
          versionTag: "release-sha",
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

  it("models read-only progressive generation metadata without accepting private fields", () => {
    const generation = {
      quizId: "33333333-3333-4333-8333-333333333333",
      state: "retry_required",
      acceptedQuestions: 3,
      plannedQuestions: 10,
      progress: 0.3,
      requestedQuestionTypes: ["multiple_choice", "short_answer"],
      aiCalls: 2,
      retryCount: 1,
      elapsedMs: 18_000,
      reasonCode: "automatic_retries_exhausted",
      stalled: false,
      lastProgressAt: "2026-08-10T04:00:00.000Z",
      createdAt: "2026-08-10T03:59:00.000Z",
      owner: {
        id: "user-1",
        name: "Learner",
        email: "learner@example.com",
      },
      video: {
        id: "video-1",
        title: "Limits",
        source: "youtube",
      },
    } as const;
    expect(AdminGenerationSchema.parse(generation)).toEqual(generation);
    expect(
      AdminGenerationsResponseSchema.parse({
        generations: [generation],
        pagination: { page: 1, pageSize: 20, total: 1 },
      }).generations,
    ).toHaveLength(1);
    expect(
      AdminGenerationSchema.safeParse({
        ...generation,
        transcript: "private captions",
      }).success,
    ).toBe(false);
  });
});

describe("video source validation", () => {
  it("recognizes supported hosts without accepting lookalikes", () => {
    expect(identifyVideoSource("https://youtu.be/abc")).toBe("youtube");
    expect(identifyVideoSource("https://vimeo.com/123456789")).toBeNull();
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

  it("accepts prompt v5.0 and v5.1 while rejecting unknown prompt metadata", () => {
    const quiz = localQuizResult(5);
    expect(
      LocalConceptQuizResultSchema.safeParse({
        ...quiz,
        promptVersion: "quiz-local-json-stream-v5.0",
      }).success,
    ).toBe(true);
    expect(
      LocalConceptQuizResultSchema.safeParse({
        ...quiz,
        promptVersion: "quiz-local-json-stream-v5.1",
      }).success,
    ).toBe(true);
    expect(
      LocalConceptQuizResultSchema.safeParse({
        ...quiz,
        promptVersion: "quiz-local-json-stream-v5.2",
      }).success,
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

  it("accepts strict sequential question chunks for progressive delivery", () => {
    const first = localQuizChunk(10, 0);
    const second = localQuizChunk(10, 1);
    expect(LocalConceptQuizChunkSchema.parse(first)).toEqual(first);
    expect(LocalConceptQuizChunkSchema.parse(second)).toEqual(second);
    expect(
      ExtensionQuizProgressiveImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "medium",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        watched: true,
        chunk: first,
      }).success,
    ).toBe(true);
  });

  it("rejects progressive chunks with the wrong position, ids, or type plan", () => {
    const chunk = localQuizChunk(10, 5);
    expect(
      LocalConceptQuizChunkSchema.safeParse({
        ...chunk,
        startIndex: 10,
      }).success,
    ).toBe(false);
    expect(
      LocalConceptQuizChunkSchema.safeParse({
        ...chunk,
        question: { ...chunk.question, id: "q5" },
      }).success,
    ).toBe(false);
    expect(
      ExtensionQuizProgressiveImportRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        quizLanguage: "en",
        sessionLength: "medium",
        questionTypes: ["multiple_choice"],
        watched: true,
        chunk,
      }).success,
    ).toBe(false);
  });

  it("requires authoritative generation counts and a truthful ready state", () => {
    expect(
      AttemptGenerationAvailabilitySchema.safeParse({
        state: "generating",
        availableQuestions: 3,
        totalQuestions: 10,
      }).success,
    ).toBe(true);
    expect(
      AttemptGenerationAvailabilitySchema.safeParse({
        state: "ready",
        availableQuestions: 3,
        totalQuestions: 10,
      }).success,
    ).toBe(false);
    expect(
      AttemptGenerationAvailabilitySchema.safeParse({
        state: "retry_required",
        availableQuestions: 3,
        totalQuestions: 10,
        reasonCode: "raw error text!",
      }).success,
    ).toBe(false);
    expect(
      AttemptGenerationAvailabilitySchema.safeParse({
        state: "generating",
        availableQuestions: 3,
        totalQuestions: 10,
        reasonCode: "generation_stalled",
      }).success,
    ).toBe(false);
  });

  it("accepts only first-missing continuation metadata with the global type plan", () => {
    const complete = localQuizResult(5);
    const acceptedQuestions = complete.quiz.questions
      .slice(0, 3)
      .map(({ id, type, concept, question }) => ({
        id,
        type,
        concept,
        question,
      }));
    const context = {
      protocolVersion: 1,
      jobId: "11111111-1111-4111-8111-111111111111",
      videoId: "22222222-2222-4222-8222-222222222222",
      title: "A trusted source title",
      quizLanguage: "en",
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      questionCount: 5,
      transcriptFingerprint: "1234abcd",
      transcriptLanguage: "en",
      segments: [{ id: "s1", startMs: 0, endMs: 1_000, text: "Lesson" }],
      continuation: { startIndex: 3, acceptedQuestions },
    };
    expect(LocalQuizContextSchema.safeParse(context).success).toBe(true);
    expect(
      LocalQuizContextSchema.safeParse({
        ...context,
        continuation: { startIndex: 2, acceptedQuestions },
      }).success,
    ).toBe(false);
    expect(
      LocalQuizContextSchema.safeParse({
        ...context,
        continuation: {
          startIndex: 3,
          acceptedQuestions: acceptedQuestions.map((question, index) =>
            index === 1 ? { ...question, type: "short_answer" } : question,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it("exposes only safe owner continuation metadata for incomplete attempts", () => {
    const complete = localQuizResult(5);
    const acceptedQuestions = complete.quiz.questions
      .slice(0, 2)
      .map(({ id, type, concept, question }) => ({
        id,
        type,
        concept,
        question,
      }));
    const response = {
      attemptId: "11111111-1111-4111-8111-111111111111",
      quizId: "22222222-2222-4222-8222-222222222222",
      generation: {
        state: "generating",
        availableQuestions: 2,
        totalQuestions: 5,
      },
      continuation: {
        videoId: "33333333-3333-4333-8333-333333333333",
        quizLanguage: "en",
        sessionLength: "short",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        watched: true,
        startIndex: 2,
        acceptedQuestions,
      },
    };
    expect(AttemptGenerationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      AttemptGenerationResponseSchema.safeParse({
        ...response,
        continuation: {
          ...response.continuation,
          apiKey: "must-never-cross-the-bridge",
          transcript: "must-stay-local",
        },
      }).success,
    ).toBe(false);
  });
});

function localQuizChunk(
  questionCount: 5 | 10 | 15,
  startIndex: number,
): LocalConceptQuizChunk {
  const complete = localQuizResult(questionCount);
  return {
    protocolVersion: complete.protocolVersion,
    pipelineVersion: complete.pipelineVersion,
    model: complete.model,
    reasoningEffort: complete.reasoningEffort,
    promptVersion: complete.promptVersion,
    validatorVersion: complete.validatorVersion,
    title: complete.quiz.title,
    startIndex,
    totalQuestions: questionCount,
    question: complete.quiz.questions[startIndex]!,
    metrics: complete.metrics,
  };
}

function localQuizResult(questionCount: 5 | 10 | 15): LocalConceptQuizResult {
  const questionTypes: QuizQuestionType[] = [
    "multiple_choice",
    "true_false",
    "short_answer",
  ];
  const typePlan = questionTypePlanForSelection(questionTypes, questionCount);
  return {
    protocolVersion: 5,
    pipelineVersion: 9,
    model: "deepseek-v4-flash" as const,
    reasoningEffort: "high" as const,
    promptVersion: "quiz-local-json-stream-v5.0" as const,
    validatorVersion: "validator-local-progressive-v4.0" as const,
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
