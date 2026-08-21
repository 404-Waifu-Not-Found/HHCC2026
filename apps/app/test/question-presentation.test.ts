import { describe, expect, it } from "vitest";
import { presentQuizPrompt } from "../src/lib/question-presentation";

describe("quiz question presentation", () => {
  it("removes empty source framing from existing stored prompts", () => {
    expect(
      presentQuizPrompt(
        "According to the lesson, what three conditions must be true for a function to be continuous at x = c?",
      ),
    ).toBe(
      "What three conditions must be true for a function to be continuous at x = c?",
    );
    expect(
      presentQuizPrompt(
        "In this lecture, how is average rate of change calculated?",
      ),
    ).toBe("How is average rate of change calculated?");
    expect(presentQuizPrompt("根据本课，连续的三个条件是什么？")).toBe(
      "连续的三个条件是什么？",
    );
  });

  it("leaves direct concept questions unchanged", () => {
    const prompt = "Where are protons and neutrons located within an atom?";
    expect(presentQuizPrompt(prompt)).toBe(prompt);
  });
});
