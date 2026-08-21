import { describe, expect, it } from "vitest";
import {
  GeneratedQuestionSchema,
  identifyVideoSource,
  questionLimitForSession,
} from "../src/index";

describe("video source validation", () => {
  it("recognizes supported hosts without accepting lookalikes", () => {
    expect(identifyVideoSource("https://youtu.be/abc")).toBe("youtube");
    expect(identifyVideoSource("https://www.bilibili.com/video/BV1xx")).toBe("bilibili");
    expect(identifyVideoSource("https://youtube.com.evil.example/video")).toBeNull();
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
});

