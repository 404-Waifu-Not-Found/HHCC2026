import type { MasteryState } from "@clipquest/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type MasterySnapshot = {
  state: MasteryState;
  bestScore: number | null;
  initialPassedAt: number | null;
  reviewPassedAt: number | null;
  nextReviewAt: number | null;
};

export function calculateMastery(
  current: MasterySnapshot,
  input: { mode: "learn" | "review"; score: number; timestamp: number },
): MasterySnapshot {
  const bestScore = Math.max(current.bestScore ?? 0, input.score);
  if (current.state === "mastered")
    return { ...current, bestScore, nextReviewAt: null };

  if (input.score >= 80 && !current.initialPassedAt) {
    return {
      state: "learning",
      bestScore,
      initialPassedAt: input.timestamp,
      reviewPassedAt: current.reviewPassedAt,
      nextReviewAt: input.timestamp + 3 * DAY_MS,
    };
  }

  if (
    input.score >= 80 &&
    current.initialPassedAt &&
    input.mode === "review" &&
    input.timestamp > current.initialPassedAt
  ) {
    return {
      state: "mastered",
      bestScore,
      initialPassedAt: current.initialPassedAt,
      reviewPassedAt: input.timestamp,
      nextReviewAt: null,
    };
  }

  return {
    state: "learning",
    bestScore,
    initialPassedAt: current.initialPassedAt,
    reviewPassedAt: current.reviewPassedAt,
    nextReviewAt: current.initialPassedAt ? input.timestamp + DAY_MS : null,
  };
}
