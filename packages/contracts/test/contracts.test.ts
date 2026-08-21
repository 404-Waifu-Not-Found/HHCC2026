import { describe, expect, it } from "vitest";
import {
  AdminMeResponseSchema,
  AdminSystemResponseSchema,
  GeneratedQuestionSchema,
  QuizQuestionTypesSchema,
  TranscriptUploadRequestSchema,
  createTranscriptCompleteness,
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
  it("rejects an out-of-range multiple-choice answer", () => {
    const parsed = GeneratedQuestionSchema.safeParse({
      id: "q1",
      conceptId: "c1",
      type: "multiple_choice",
      prompt: "Which statement is supported?",
      reformulatedPrompt: "Pick the supported statement.",
      explanation: "The speaker states this directly.",
      evidenceSegmentIds: ["s1"],
      difficulty: 2,
      options: ["A", "B"],
      correctAnswer: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it("does not accept ordering as a generated question type", () => {
    expect(
      GeneratedQuestionSchema.safeParse({
        id: "q1",
        conceptId: "c1",
        type: "ordering",
        prompt: "Put these ideas in order.",
        reformulatedPrompt: "Order the ideas.",
        explanation: "The order follows the video.",
        evidenceSegmentIds: ["s1"],
        difficulty: 2,
        items: ["A", "B"],
        correctAnswer: [0, 1],
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
});

describe("complete transcript contract", () => {
  const segments = [
    {
      id: "s1",
      startMs: 0,
      endMs: 1_000,
      text: "Every subtitle line is included.",
    },
    {
      id: "s2",
      startMs: 1_000,
      endMs: 2_000,
      text: "Nothing is silently sampled or cut.",
    },
  ];

  it("accepts an exact complete-transcript manifest", () => {
    expect(
      TranscriptUploadRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        language: "en",
        origin: "captions",
        acquisition: "youtube_signed_captions",
        completeness: createTranscriptCompleteness(segments, 2),
        segments,
        quizLanguage: "en",
        sessionLength: "long",
        watched: true,
        questionTypes: ["multiple_choice"],
      }).success,
    ).toBe(true);
  });

  it("rejects changed or partial text against the completeness manifest", () => {
    expect(
      TranscriptUploadRequestSchema.safeParse({
        videoId: "11111111-1111-4111-8111-111111111111",
        language: "en",
        origin: "captions",
        completeness: createTranscriptCompleteness(segments, 2),
        segments: segments.slice(0, 1),
        quizLanguage: "en",
        sessionLength: "long",
        watched: true,
        questionTypes: ["multiple_choice"],
      }).success,
    ).toBe(false);
  });
});
