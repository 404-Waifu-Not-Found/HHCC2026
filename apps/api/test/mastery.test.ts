import { describe, expect, it } from "vitest";
import { calculateMastery, type MasterySnapshot } from "../src/lib/mastery";

const empty: MasterySnapshot = {
  state: "not_started",
  bestScore: null,
  initialPassedAt: null,
  reviewPassedAt: null,
  nextReviewAt: null,
};

describe("calculateMastery", () => {
  it("assigns Basic to a first attempt below 80%", () => {
    expect(
      calculateMastery(empty, { mode: "learn", score: 60, timestamp: 1_000 }),
    ).toMatchObject({
      state: "basic",
      initialPassedAt: null,
      nextReviewAt: null,
    });
  });

  it.each([
    [100, "mastered"],
    [99, "expert"],
    [90, "expert"],
    [89, "intermediate"],
    [80, "intermediate"],
    [79, "basic"],
  ] as const)("maps %s%% to the %s rank", (score, state) => {
    expect(
      calculateMastery(empty, { mode: "learn", score, timestamp: 1_000 }),
    ).toMatchObject({
      state,
      bestScore: score,
    });
  });

  it("promotes a later review when it improves the best score", () => {
    const learning = calculateMastery(empty, {
      mode: "learn",
      score: 80,
      timestamp: 1_000,
    });
    expect(
      calculateMastery(learning, {
        mode: "review",
        score: 100,
        timestamp: 259_201_000,
      }),
    ).toMatchObject({
      state: "mastered",
      bestScore: 100,
      reviewPassedAt: 259_201_000,
      nextReviewAt: null,
    });
  });
});
