import { describe, expect, it } from "vitest";
import {
  createChoicePresentation,
  createInitialOrdering,
} from "../src/lib/quiz-order";

describe("createInitialOrdering", () => {
  it("never presents the source order as a free answer", () => {
    expect(createInitialOrdering(4, () => 0.999)).not.toEqual([0, 1, 2, 3]);
  });

  it("keeps every item exactly once", () => {
    expect(createInitialOrdering(5, () => 0.25).sort()).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
});

describe("createChoicePresentation", () => {
  it("returns every option once with a display-to-canonical mapping", () => {
    const canonical = ["A", "B", "C", "D"];
    const presentation = createChoicePresentation(canonical, () => 0);
    expect([...presentation.options].sort()).toEqual(canonical);
    presentation.options.forEach((option, displayIndex) => {
      expect(canonical[presentation.displayToCanonical[displayIndex]!]).toBe(
        option,
      );
    });
  });

  it("creates a fresh permutation for each activation", () => {
    const canonical = ["A", "B", "C", "D"];
    const first = createChoicePresentation(canonical, () => 0);
    const identityDraws = [3, 2, 1];
    const second = createChoicePresentation(
      canonical,
      () => identityDraws.shift() ?? 0,
    );
    expect(first.displayToCanonical).not.toEqual(second.displayToCanonical);
  });
});
