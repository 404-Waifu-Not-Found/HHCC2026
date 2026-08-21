import type { MasteryState } from "@clipquest/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;

function masteryStateForScore(
  score: number,
): Exclude<MasteryState, "not_started"> {
  if (score >= 100) return "mastered";
  if (score >= 90) return "expert";
  if (score >= 80) return "intermediate";
  return "basic";
}

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
  const state = masteryStateForScore(bestScore);
  const initialPassedAt =
    current.initialPassedAt ?? (input.score >= 80 ? input.timestamp : null);
  const reviewPassedAt =
    input.mode === "review" &&
    current.initialPassedAt &&
    input.timestamp > current.initialPassedAt
      ? input.timestamp
      : current.reviewPassedAt;

  if (state === "mastered") {
    return {
      state,
      bestScore,
      initialPassedAt,
      reviewPassedAt,
      nextReviewAt: null,
    };
  }

  if (initialPassedAt && reviewPassedAt) {
    return {
      state,
      bestScore,
      initialPassedAt,
      reviewPassedAt,
      nextReviewAt: null,
    };
  }

  return {
    state,
    bestScore,
    initialPassedAt,
    reviewPassedAt,
    nextReviewAt:
      initialPassedAt && !reviewPassedAt
        ? input.timestamp + (current.initialPassedAt ? DAY_MS : 3 * DAY_MS)
        : null,
  };
}
