import { describe, expect, it } from "vitest";
import { estimatedGenerationDurationMs } from "../src/generation/eta";

describe("generation ETA", () => {
  it.each([
    [5, 45_000],
    [10, 60_000],
    [15, 65_000],
  ] as const)(
    "uses the measured rounded estimate for %i questions",
    (questionCount, expectedMs) => {
      expect(estimatedGenerationDurationMs(questionCount)).toBe(expectedMs);
    },
  );

  it("never decreases as the requested quiz gets longer", () => {
    const estimates = [5, 10, 15].map((count) =>
      estimatedGenerationDurationMs(count as 5 | 10 | 15),
    );

    expect(estimates).toEqual([...estimates].sort((a, b) => a - b));
  });
});
