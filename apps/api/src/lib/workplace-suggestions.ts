import type { MasteryState, WorkplaceSuggestion } from "@clipquest/contracts";

// A learner's owned library row, already filtered to their own videos. The
// caller must supply `candidates` ordered by `updatedAt` descending (most
// recently added/watched first) -- this function is a pure, deterministic
// transform over that order and never queries anything itself, which keeps
// the personalization rules directly unit-testable.
export type WorkplaceSuggestionCandidate = {
  videoId: string;
  title: string;
  quizId: string | null;
  masteryState: MasteryState;
  bestScore: number | null;
  nextReviewAt: number | null;
  updatedAt: number;
};

const MASTERY_RANK: Record<MasteryState, number> = {
  not_started: 0,
  basic: 1,
  intermediate: 2,
  expert: 3,
  mastered: 4,
};

const MAX_TITLE_LENGTH = 300;
const MAX_REASON_LENGTH = 300;

function truncate(value: string, maxLength: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}\u2026`;
}

function safeTitle(title: string): string {
  return truncate(title, MAX_TITLE_LENGTH, "Untitled video");
}

function reason(text: string): string {
  return truncate(text, MAX_REASON_LENGTH, "Recommended for you.");
}

// Picks the deterministic recent/unmastered/due trio the
// `WorkplaceSuggestionsResponseSchema` exact-three contract requires. Never
// invents a video ID: every suggestion always references one of the videos
// already present in `candidates`, reusing a video across suggestion kinds
// when the learner's library is too sparse to fill all three distinctly.
// Returns null only when the learner has no eligible videos at all, which
// the caller should treat as "suggestions unavailable" rather than
// fabricate a video reference.
export function selectWorkplaceSuggestions(
  candidates: WorkplaceSuggestionCandidate[],
  timestamp: number,
): WorkplaceSuggestion[] | null {
  if (candidates.length === 0) return null;

  const recent = candidates[0]!;

  // Weakest performance first (lowest mastery rank, then lowest best
  // score), preferring an entry distinct from `recent` but falling back to
  // reusing it when the library only has one video worth suggesting.
  const byWeakestMastery = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const rankDiff =
        MASTERY_RANK[a.candidate.masteryState] -
        MASTERY_RANK[b.candidate.masteryState];
      if (rankDiff !== 0) return rankDiff;
      const scoreDiff =
        (a.candidate.bestScore ?? -1) - (b.candidate.bestScore ?? -1);
      if (scoreDiff !== 0) return scoreDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
  const unmastered =
    byWeakestMastery.find(
      (candidate) => candidate.videoId !== recent.videoId,
    ) ?? byWeakestMastery[0]!;

  // Genuinely due reviews first (earliest next review, i.e. most overdue),
  // preferring an entry distinct from the two already-chosen videos. Falls
  // back to the least-recently-touched video ("older") when nothing is
  // actually due, and finally reuses an earlier pick for a very sparse
  // library.
  const dueNow = candidates
    .filter(
      (candidate) =>
        candidate.masteryState !== "mastered" &&
        candidate.nextReviewAt !== null &&
        candidate.nextReviewAt <= timestamp,
    )
    .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));
  const chosen = new Set([recent.videoId, unmastered.videoId]);
  const oldestFirst = [...candidates].reverse();
  const due =
    dueNow.find((candidate) => !chosen.has(candidate.videoId)) ??
    dueNow[0] ??
    oldestFirst.find((candidate) => !chosen.has(candidate.videoId)) ??
    oldestFirst[0]!;
  const dueIsGenuine = dueNow.some(
    (candidate) => candidate.videoId === due.videoId,
  );

  return [
    {
      kind: "recent",
      videoId: recent.videoId,
      quizId: recent.quizId,
      title: safeTitle(recent.title),
      reason: reason(
        `You recently added or watched \u201c${safeTitle(recent.title)}.\u201d`,
      ),
    },
    {
      kind: "unmastered",
      videoId: unmastered.videoId,
      quizId: unmastered.quizId,
      title: safeTitle(unmastered.title),
      reason: reason(
        unmastered.masteryState === "mastered"
          ? `Revisit \u201c${safeTitle(unmastered.title)}\u201d to keep it sharp.`
          : `You haven't mastered \u201c${safeTitle(unmastered.title)}\u201d yet.`,
      ),
    },
    {
      kind: "due",
      videoId: due.videoId,
      quizId: due.quizId,
      title: safeTitle(due.title),
      reason: reason(
        dueIsGenuine
          ? `\u201c${safeTitle(due.title)}\u201d is due for review.`
          : `Revisit \u201c${safeTitle(due.title)}\u201d, one of your earliest saved videos.`,
      ),
    },
  ];
}
