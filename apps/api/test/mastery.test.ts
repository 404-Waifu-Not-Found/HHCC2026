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
  it("does not schedule an impossible review after a failed first attempt", () => {
    expect(calculateMastery(empty, { mode: "learn", score: 60, timestamp: 1_000 })).toMatchObject({
      state: "learning",
      initialPassedAt: null,
      nextReviewAt: null,
    });
  });

  it("schedules the first review three days after an initial pass", () => {
    expect(calculateMastery(empty, { mode: "learn", score: 80, timestamp: 1_000 })).toMatchObject({
      state: "learning",
      initialPassedAt: 1_000,
      nextReviewAt: 259_201_000,
    });
  });

  it("marks mastery only after a later passing review", () => {
    const learning = calculateMastery(empty, { mode: "learn", score: 90, timestamp: 1_000 });
    expect(calculateMastery(learning, { mode: "review", score: 90, timestamp: 259_201_000 })).toMatchObject({
      state: "mastered",
      reviewPassedAt: 259_201_000,
      nextReviewAt: null,
    });
  });
});
