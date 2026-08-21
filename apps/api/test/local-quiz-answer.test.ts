import { describe, expect, it } from "vitest";
import { parseQuestionEvidence } from "../src/routes/quizzes";

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
});
