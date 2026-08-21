import { describe, expect, it } from "vitest";
import { createInitialOrdering } from "../src/lib/quiz-order";

describe("createInitialOrdering", () => {
  it("never presents the source order as a free answer", () => {
    expect(createInitialOrdering(4, () => 0.999)).not.toEqual([0, 1, 2, 3]);
  });

  it("keeps every item exactly once", () => {
    expect(createInitialOrdering(5, () => 0.25).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
