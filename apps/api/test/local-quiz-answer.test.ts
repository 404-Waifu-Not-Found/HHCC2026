import { describe, expect, it } from "vitest";
import {
  hasDistinctAdaptiveRetry,
  parseQuestionEvidence,
  shortAnswerModelAnswer,
} from "../src/routes/quizzes";

describe("short-answer model answer", () => {
  it("surfaces the first acceptable alternative of a stored rubric", () => {
    expect(
      shortAnswerModelAnswer({
        type: "short_answer",
        rubric_json: JSON.stringify({
          requiredIdeas: ["reconstructing the idea strengthens access"],
          acceptableAlternatives: [
            "  Recalling an idea rebuilds it and strengthens later access.  ",
            "Effortful retrieval strengthens memory.",
          ],
        }),
      }),
    ).toBe("Recalling an idea rebuilds it and strengthens later access.");
  });

  it("returns null for other question types, missing rubrics, and malformed JSON", () => {
    expect(
      shortAnswerModelAnswer({ type: "multiple_choice", rubric_json: "{}" }),
    ).toBeNull();
    expect(
      shortAnswerModelAnswer({ type: "short_answer", rubric_json: null }),
    ).toBeNull();
    expect(
      shortAnswerModelAnswer({
        type: "short_answer",
        rubric_json: "{not json",
      }),
    ).toBeNull();
    expect(
      shortAnswerModelAnswer({
        type: "short_answer",
        rubric_json: JSON.stringify({
          requiredIdeas: ["x"],
          acceptableAlternatives: [],
        }),
      }),
    ).toBeNull();
  });
});

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
