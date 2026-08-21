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
    expect(
      presentQuizPrompt(
        "According to the lecturer, what is the quotient rule?",
      ),
    ).toBe("What is the quotient rule?");
    expect(presentQuizPrompt("根据本课，连续的三个条件是什么？")).toBe(
      "连续的三个条件是什么？",
    );
  });

  it("leaves direct concept questions unchanged", () => {
    const prompt = "Where are protons and neutrons located within an atom?";
    expect(presentQuizPrompt(prompt)).toBe(prompt);
  });

  it("never consumes a possessive or a prefix of a longer source noun", () => {
    const preserved = [
      "In the lesson's polynomial example, what happens to the leading term?",
      "In the video’s matrix-based representation, what does each row encode?",
      "Based on the lecturer's account, why does the limit fail to exist?",
      "Based on the lecturer’s account, how is continuity defined?",
    ];
    for (const prompt of preserved) {
      const presented = presentQuizPrompt(prompt);
      expect(presented).toBe(prompt);
      expect(presented).not.toMatch(/^(?:'S|R(?:'s|,))/u);
    }
  });

  it("preserves incomplete attribution instead of removing a partial clause", () => {
    const prompt = "According to the lesson continuity has three conditions.";
    expect(presentQuizPrompt(prompt)).toBe(prompt);
  });
});
