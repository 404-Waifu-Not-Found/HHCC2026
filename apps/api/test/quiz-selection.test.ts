import { describe, expect, it } from "vitest";
import {
  selectEligibleQuestions,
  selectVariedQuestions,
} from "../src/routes/quizzes";

const rows = Array.from({ length: 15 }, (_, ordinal) => ({
  id: crypto.randomUUID(),
  quiz_id: crypto.randomUUID(),
  ordinal,
  type:
    ordinal === 3
      ? ("ordering" as const)
      : ordinal % 2
        ? ("true_false" as const)
        : ("multiple_choice" as const),
  concept_id: `concept-${ordinal}`,
  prompt: `Question ${ordinal}`,
  reformulated_prompt: `Reworded ${ordinal}`,
  options_json: null,
  items_json: null,
  correct_answer_json: null,
  rubric_json: null,
  explanation: `Explanation ${ordinal}`,
  evidence_segment_ids_json: "[]",
  difficulty: 2,
}));

describe("quiz question selection", () => {
  it("never serves ordering and honors the requested types", () => {
    const selected = selectEligibleQuestions(rows, ["true_false"]);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((question) => question.type === "true_false")).toBe(
      true,
    );
  });

  it("samples a short session across the complete generated bank", () => {
    const selected = selectVariedQuestions(rows, 5);
    expect(selected.map((question) => question.ordinal)).toEqual([
      0, 4, 7, 11, 14,
    ]);
  });
});
