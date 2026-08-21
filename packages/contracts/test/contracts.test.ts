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
  GenerationFailureCodeSchema,
  GenerationRecordV2Schema,
  GenerationRecordV3Schema,
  LibraryCardSchema,
  LocalConceptQuizChunkSchema,
  LocalConceptQuizResultSchema,
  LocalConceptQuizQuestionChunkSchema,
  LocalGenerationCallEventSchema,
  MinimalGenerationFailureCodeSchema,
  PromptFirstQuestionSchema,
  LocalQuizContextSchema,
  QuizGenerationProfileResponseSchema,
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
          rolloutMode: "disabled",
          supportedProfile: "prompt_first_auto_v5_12",
          supportedPromptVersion: "quiz-local-json-stream-v5.12",
          supportedValidatorVersion: "validator-minimal-gradeability-v5.3",
          effectiveDefaultProfile: "legacy_reasoning_v5_1",
          requiredExtensionVersion: "0.8.17",
          requiredCapability: "question-stream-v7",
          states: {
            generating: 1,
            retrying: 2,
            recovering: 0,
            cooldown: 0,
            retryRequired: 3,
            actionRequired: 0,
            generationFailed: 0,
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
      telemetrySource: "authoritative_calls",
      primaryCalls: 1,
      automaticRetries: 1,
      manualContinuations: 0,
      partialCalls: 1,
      outcomeCounts: { complete: 1, transient_http: 1 },
      tokenUsage: {
        inputTokens: 1_000,
        outputTokens: 200,
        reasoningTokens: 0,
        completeCalls: 1,
        unknownCalls: 1,
        complete: false,
      },
      firstQuestionLatencyMs: 4_200,
      reasonCode: "schema_invalid",
      stalled: false,
      lastProgressAt: "2026-08-10T04:00:00.000Z",
      lastQuestionAt: "2026-08-10T03:59:55.000Z",
      lastAttemptAt: "2026-08-10T04:00:00.000Z",
      stateChangedAt: "2026-08-10T03:59:58.000Z",
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

  it("carries progressive replay settings on Library cards", () => {
    const card = LibraryCardSchema.parse({
      videoId: "11111111-1111-4111-8111-111111111111",
      quizId: "22222222-2222-4222-8222-222222222222",
      attemptId: null,
      originalUrl: "https://www.youtube.com/watch?v=library-replay",
      source: "youtube",
      title: "Library replay",
      thumbnailUrl: "https://example.com/thumbnail.jpg",
      bestScore: 67,
      mastery: "learning",
      action: "start",
      dueForReview: false,
      startSettings: {
        sessionLength: "long",
        questionTypes: ["short_answer"],
      },
    });
    expect(card.startSettings).toEqual({
      sessionLength: "long",
      questionTypes: ["short_answer"],
    });
  });
});

describe("generated questions", () => {
  it("binds rollout profiles to their exact extension contracts", () => {
    expect(
      QuizGenerationProfileResponseSchema.safeParse({
        generationProfile: "stable_non_thinking_v5_2",
        minimumExtensionVersion: "0.8.2",
        requiredCapability: "question-stream-v2",
      }).success,
    ).toBe(true);
    expect(
      QuizGenerationProfileResponseSchema.safeParse({
        generationProfile: "stable_non_thinking_v5_2",
        minimumExtensionVersion: "0.8.0",
        requiredCapability: "question-stream-v1",
      }).success,
    ).toBe(false);
  });

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
        resultProtocolVersion: 5,
        pipelineVersion: 9,
        model: "deepseek-v4-flash",
        reasoningEffort: "high",
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
        importVersion: "extension-progressive-import-v3",
        generationProfile: "legacy_reasoning_v5_1",
        automaticRetryCount: 0,
        retryBudgetUsedCount: 1,
        claim: { state: "available", leaseExpiresAt: null },
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

  it("accepts coherent v5.2 plans, call events, and generation records", () => {
    const questionPlan = {
      seed: "a".repeat(64),
      types: [
        "multiple_choice",
        "true_false",
        "short_answer",
        "multiple_choice",
        "true_false",
      ],
    } as const;
    const chunk = {
      protocolVersion: 6,
      pipelineVersion: 9,
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      promptVersion: "quiz-local-json-stream-v5.2",
      validatorVersion: "validator-local-progressive-v4.1",
      importVersion: "extension-progressive-import-v4",
      generationProfile: "stable_non_thinking_v5_2",
      generationId: "11111111-1111-4111-8111-111111111111",
      questionPlan,
      title: "Trusted source title",
      startIndex: 0,
      totalQuestions: 5,
      question: localQuestion("multiple_choice", 0),
      metrics: {
        aiCalls: 0,
        retryCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        elapsedMs: 1,
      },
    } as const;
    expect(LocalConceptQuizQuestionChunkSchema.safeParse(chunk).success).toBe(
      true,
    );
    expect(
      LocalConceptQuizQuestionChunkSchema.safeParse({
        ...chunk,
        protocolVersion: 5,
      }).success,
    ).toBe(false);

    expect(
      LocalGenerationCallEventSchema.safeParse({
        generationSessionId: "22222222-2222-4222-8222-222222222222",
        callIndex: 0,
        startIndex: 0,
        requestedCount: 1,
        acceptedCount: 1,
        classification: "primary",
        outcome: "complete",
        retryDelayMs: 0,
        elapsedMs: 2_000,
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 0,
        usageComplete: true,
      }).success,
    ).toBe(true);
    expect(
      LocalGenerationCallEventSchema.safeParse({
        protocolVersion: 5,
        purpose: "automatic_recovery",
        generationSessionId: "22222222-2222-4222-8222-222222222222",
        recoverySessionId: "33333333-3333-4333-8333-333333333333",
        callIndex: 7,
        startIndex: 11,
        ordinalAttempt: 2,
        requestedCount: 1,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "content_repair",
        outcome: "schema_invalid",
        retryDelayMs: 250,
        elapsedMs: 2_000,
        usageComplete: false,
      }).success,
    ).toBe(true);

    expect(
      GenerationRecordV2Schema.safeParse({
        version: 2,
        generationId: "11111111-1111-4111-8111-111111111111",
        generationSessionId: "22222222-2222-4222-8222-222222222222",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        ownerUserId: "owner-user",
        videoId: "44444444-4444-4444-8444-444444444444",
        quizLanguage: "en",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        sessionLength: "short",
        watched: true,
        questionPlan,
        acceptedCount: 0,
        plannedCount: 5,
        state: "pending",
        nextCallIndex: 0,
        createdAt: 1_786_300_000_000,
        updatedAt: 1_786_300_000_000,
      }).success,
    ).toBe(true);
  });

  it("requires protocol-7 singleton telemetry and automatic recovery metadata", () => {
    const generationId = "11111111-1111-4111-8111-111111111111";
    const generationSessionId = "22222222-2222-4222-8222-222222222222";
    const recoverySessionId = "33333333-3333-4333-8333-333333333333";
    const questionPlan = {
      seed: "b".repeat(64),
      types: Array(5).fill("multiple_choice"),
    } as const;
    const chunk = {
      protocolVersion: 7,
      pipelineVersion: 9,
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      promptVersion: "quiz-local-json-stream-v5.3",
      validatorVersion: "validator-local-progressive-v4.2",
      importVersion: "extension-progressive-import-v5",
      generationProfile: "stable_auto_recovery_v5_3",
      generationId,
      generationSessionId,
      recoverySessionId,
      questionPlan,
      title: "Trusted source title",
      startIndex: 0,
      totalQuestions: 5,
      question: localQuestion("multiple_choice", 0),
      metrics: {
        aiCalls: 0,
        retryCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        elapsedMs: 1,
      },
    } as const;
    expect(LocalConceptQuizQuestionChunkSchema.safeParse(chunk).success).toBe(
      true,
    );
    expect(
      LocalConceptQuizQuestionChunkSchema.safeParse({
        ...chunk,
        recoverySessionId: undefined,
      }).success,
    ).toBe(false);

    const primary = {
      protocolVersion: 7,
      generationSessionId,
      recoverySessionId,
      callIndex: 0,
      startIndex: 0,
      ordinalAttempt: 1,
      requestedCount: 1,
      acceptedCount: 1,
      classification: "primary",
      outcome: "complete",
      retryDelayMs: 0,
      elapsedMs: 2_000,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 0,
      usageComplete: true,
    } as const;
    expect(LocalGenerationCallEventSchema.safeParse(primary).success).toBe(
      true,
    );
    expect(
      LocalGenerationCallEventSchema.safeParse({
        ...primary,
        classification: "manual_continuation",
      }).success,
    ).toBe(false);
    expect(
      LocalGenerationCallEventSchema.safeParse({
        ...primary,
        callIndex: 1,
        ordinalAttempt: 2,
        acceptedCount: 0,
        classification: "automatic_retry",
        outcome: "schema_invalid",
      }).success,
    ).toBe(false);
    expect(
      LocalGenerationCallEventSchema.safeParse({
        ...primary,
        callIndex: 1,
        ordinalAttempt: 2,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "content_repair",
        outcome: "schema_invalid",
      }).success,
    ).toBe(true);

    const generationRecord = {
      version: 3,
      generationId,
      generationSessionId,
      recoverySessionId,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "owner-user",
      videoId: "55555555-5555-4555-8555-555555555555",
      quizLanguage: "en",
      questionTypes: ["multiple_choice"],
      sessionLength: "short",
      watched: true,
      questionPlan,
      generationProfile: "stable_auto_recovery_v5_3",
      acceptedCount: 1,
      plannedCount: 5,
      state: "action_required",
      reasonCode: "credential_required",
      nextCallIndex: 1,
      ordinalAttempts: { "2": 1 },
      automaticRetryCount: 0,
      activeRecoveryStartedAt: 1_786_300_000_000,
      createdAt: 1_786_300_000_000,
      updatedAt: 1_786_300_000_000,
    } as const;
    expect(GenerationRecordV3Schema.safeParse(generationRecord).success).toBe(
      true,
    );
    expect(
      GenerationRecordV3Schema.safeParse({
        ...generationRecord,
        reasonCode: undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts only coherent v5.7 grounded metadata and bounded repair outcomes", () => {
    const questionPlan = {
      seed: "c".repeat(64),
      types: Array(5).fill("multiple_choice"),
    } as const;
    const chunk = {
      protocolVersion: 8,
      pipelineVersion: 9,
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      promptVersion: "quiz-local-json-stream-v5.7",
      validatorVersion: "validator-local-progressive-v4.6",
      importVersion: "extension-progressive-import-v6",
      generationProfile: "evidence_grounded_auto_v5_4",
      generationId: "11111111-1111-4111-8111-111111111111",
      generationSessionId: "22222222-2222-4222-8222-222222222222",
      recoverySessionId: "33333333-3333-4333-8333-333333333333",
      questionPlan,
      title: "Trusted source title",
      startIndex: 0,
      totalQuestions: 5,
      question: localQuestion("multiple_choice", 0),
      metrics: {
        aiCalls: 0,
        retryCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        elapsedMs: 1,
      },
    } as const;
    expect(LocalConceptQuizQuestionChunkSchema.safeParse(chunk).success).toBe(
      true,
    );
    expect(
      LocalConceptQuizQuestionChunkSchema.safeParse({
        ...chunk,
        promptVersion: "quiz-local-json-stream-v5.6",
      }).success,
    ).toBe(false);
    for (const outcome of [
      "source_framing_invalid",
      "course_logistics_invalid",
      "low_pedagogical_value",
      "rubric_invalid",
      "non_instructional_source",
    ]) {
      expect(GenerationFailureCodeSchema.safeParse(outcome).success).toBe(true);
    }
  });

  it("accepts coherent v5.8 concept-first metadata, atomic rubrics, and call lifecycles", () => {
    const questionPlan = {
      seed: "d".repeat(64),
      types: Array(5).fill("short_answer"),
    } as const;
    const chunk = {
      protocolVersion: 9,
      pipelineVersion: 9,
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      promptVersion: "quiz-local-json-stream-v5.8",
      validatorVersion: "validator-local-progressive-v4.12",
      importVersion: "extension-progressive-import-v7",
      generationProfile: "concept_first_auto_v5_8",
      generationId: "11111111-1111-4111-8111-111111111111",
      generationSessionId: "22222222-2222-4222-8222-222222222222",
      recoverySessionId: "33333333-3333-4333-8333-333333333333",
      questionPlan,
      promptFingerprint: "e".repeat(64),
      title: "Atmospheric science",
      startIndex: 0,
      totalQuestions: 5,
      question: {
        ...localQuestion("short_answer", 0),
        answer: "atmosphere",
        rubricIdeas: ["atmosphere"],
        acceptableAnswers: [],
        shortAnswerMode: "atomic_term",
        rubricV2: {
          version: 2,
          mode: "atomic_term",
          canonicalAnswer: "atmosphere",
          aliases: ["the atmosphere"],
        },
      },
      metrics: {
        aiCalls: 0,
        retryCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        elapsedMs: 1,
        sourceSelection: {
          sentenceCount: 12,
          excludedSentenceCount: 2,
          candidateWindowCount: 10,
          selectedWindowCount: 5,
          focusWordCount: 80,
        },
      },
    } as const;
    expect(LocalConceptQuizQuestionChunkSchema.safeParse(chunk).success).toBe(
      true,
    );
    expect(
      LocalConceptQuizQuestionChunkSchema.safeParse({
        ...chunk,
        promptFingerprint: undefined,
      }).success,
    ).toBe(false);
    const lifecycleBase = {
      protocolVersion: 9,
      purpose: "generation",
      generationSessionId: chunk.generationSessionId,
      recoverySessionId: chunk.recoverySessionId,
      callIndex: 0,
      startIndex: 0,
      ordinalAttempt: 1,
      requestedCount: 1,
      classification: "primary",
      retryDelayMs: 0,
      usageComplete: false,
    } as const;
    expect(
      LocalGenerationCallEventSchema.safeParse({
        ...lifecycleBase,
        lifecycleState: "started",
        acceptedCount: 0,
      }).success,
    ).toBe(true);
    expect(
      LocalGenerationCallEventSchema.safeParse({
        ...lifecycleBase,
        lifecycleState: "completed",
        acceptedCount: 1,
        outcome: "complete",
        elapsedMs: 900,
      }).success,
    ).toBe(true);
  });

  it("accepts protocol-10 prompt-first questions and only minimal failure telemetry", () => {
    expect(
      PromptFirstQuestionSchema.safeParse({
        type: "multiple_choice",
        concept: "atmospheric composition",
        question: "What surrounds Earth?",
        explanation: "A layer of gases surrounds Earth.",
        correctAnswer: "the atmosphere",
        distractors: ["the crust", "the mantle", "the core"],
      }).success,
    ).toBe(true);
    expect(
      MinimalGenerationFailureCodeSchema.safeParse("source_framing_invalid")
        .success,
    ).toBe(false);
    expect(
      LocalGenerationCallEventSchema.safeParse({
        protocolVersion: 10,
        purpose: "generation",
        lifecycleState: "completed",
        generationSessionId: "22222222-2222-4222-8222-222222222222",
        recoverySessionId: "33333333-3333-4333-8333-333333333333",
        callIndex: 1,
        startIndex: 0,
        ordinalAttempt: 2,
        requestedCount: 1,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "structural",
        outcome: "choice_structure_invalid",
        retryDelayMs: 200,
        elapsedMs: 500,
        usageComplete: false,
      }).success,
    ).toBe(true);
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
