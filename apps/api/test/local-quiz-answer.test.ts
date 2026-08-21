import { describe, expect, it } from "vitest";
import {
  hasDistinctAdaptiveRetry,
  parseQuestionEvidence,
} from "../src/routes/quizzes";

describe("local extension quiz evidence", () => {
  it("accepts an intentionally empty evidence list", () => {
    expect(parseQuestionEvidence({ evidence_segment_ids_json: "[]" })).toEqual(
      [],
    );
  });

  it("still rejects malformed evidence metadata", () => {
    expect(() =>
      parseQuestionEvidence({ evidence_segment_ids_json: '"not-an-array"' }),
    ).toThrow(/question evidence/);
  });

  it("never repeats an identical prompt as an adaptive retry", () => {
    expect(
      hasDistinctAdaptiveRetry({
        prompt: "What role does water play?",
        reformulated_prompt: "What role does water play?!",
      }),
    ).toBe(false);
    expect(
      hasDistinctAdaptiveRetry({
        prompt: "What role does water play?",
        reformulated_prompt: "How does water help the body function?",
      }),
    ).toBe(true);
  });
});
