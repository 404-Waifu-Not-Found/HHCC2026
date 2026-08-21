import { describe, expect, it } from "vitest";
import {
  selectWorkplaceSuggestions,
  type WorkplaceSuggestionCandidate,
} from "../src/lib/workplace-suggestions";

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(
  overrides: Partial<WorkplaceSuggestionCandidate> & { videoId: string },
): WorkplaceSuggestionCandidate {
  return {
    title: `Video ${overrides.videoId}`,
    quizId: null,
    masteryState: "not_started",
    bestScore: null,
    nextReviewAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("selectWorkplaceSuggestions", () => {
  it("returns null when the library is empty", () => {
    expect(selectWorkplaceSuggestions([], NOW)).toBeNull();
  });

  it("always returns exactly three suggestions with unique kinds when candidates exist", () => {
    const candidates = [
      candidate({ videoId: "11111111-1111-1111-1111-111111111111" }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW);
    expect(suggestions).not.toBeNull();
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions!.map((s) => s.kind)).size).toBe(3);
    expect(new Set(suggestions!.map((s) => s.kind))).toEqual(
      new Set(["recent", "unmastered", "due"]),
    );
  });

  it("never invents a video ID: every suggestion references a candidate video", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "mastered",
        bestScore: 1,
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "basic",
        bestScore: 0.4,
        nextReviewAt: NOW - DAY_MS,
      }),
      candidate({
        videoId: "33333333-3333-3333-3333-333333333333",
        updatedAt: NOW - 2 * DAY_MS,
        masteryState: "not_started",
        nextReviewAt: NOW + DAY_MS,
      }),
    ];
    const validIds = new Set(candidates.map((c) => c.videoId));
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    for (const suggestion of suggestions) {
      expect(validIds.has(suggestion.videoId)).toBe(true);
      expect(suggestion.title.length).toBeGreaterThan(0);
      expect(suggestion.title.length).toBeLessThanOrEqual(300);
      expect(suggestion.reason.length).toBeGreaterThan(0);
      expect(suggestion.reason.length).toBeLessThanOrEqual(300);
    }
  });

  it("picks the most recently updated candidate as 'recent'", () => {
    const candidates = [
      candidate({ videoId: "11111111-1111-1111-1111-111111111111", updatedAt: NOW }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    const recent = suggestions.find((s) => s.kind === "recent")!;
    expect(recent.videoId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("picks the weakest-mastery candidate distinct from 'recent' as 'unmastered'", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "mastered",
        bestScore: 1,
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "not_started",
        bestScore: null,
      }),
      candidate({
        videoId: "33333333-3333-3333-3333-333333333333",
        updatedAt: NOW - 2 * DAY_MS,
        masteryState: "expert",
        bestScore: 0.9,
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    const unmastered = suggestions.find((s) => s.kind === "unmastered")!;
    expect(unmastered.videoId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("picks the earliest genuinely-due, non-mastered candidate as 'due'", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "intermediate",
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "basic",
        nextReviewAt: NOW - 5 * DAY_MS,
      }),
      candidate({
        videoId: "33333333-3333-3333-3333-333333333333",
        updatedAt: NOW - 2 * DAY_MS,
        masteryState: "expert",
        nextReviewAt: NOW - 1 * DAY_MS,
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    const due = suggestions.find((s) => s.kind === "due")!;
    // Video 2 is the most overdue candidate, but it is also the weakest by
    // mastery rank and so is already claimed by 'unmastered'; 'due' must
    // pick a distinct video, falling through to the next most-overdue
    // candidate (video 3).
    expect(suggestions.find((s) => s.kind === "unmastered")!.videoId).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(due.videoId).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("picks the most-overdue candidate as 'due' when it is distinct from 'unmastered'", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "mastered",
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "not_started",
      }),
      candidate({
        videoId: "33333333-3333-3333-3333-333333333333",
        updatedAt: NOW - 2 * DAY_MS,
        masteryState: "expert",
        nextReviewAt: NOW - 5 * DAY_MS,
      }),
      candidate({
        videoId: "44444444-4444-4444-4444-444444444444",
        updatedAt: NOW - 3 * DAY_MS,
        masteryState: "intermediate",
        nextReviewAt: NOW - 1 * DAY_MS,
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    const due = suggestions.find((s) => s.kind === "due")!;
    expect(due.videoId).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("falls back gracefully to reused videos for a single-video library", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        masteryState: "not_started",
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(suggestion.videoId).toBe("11111111-1111-1111-1111-111111111111");
    }
    expect(new Set(suggestions.map((s) => s.kind)).size).toBe(3);
  });

  it("falls back gracefully for a two-video library with nothing due", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "mastered",
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "mastered",
      }),
    ];
    const suggestions = selectWorkplaceSuggestions(candidates, NOW)!;
    expect(suggestions).toHaveLength(3);
    const validIds = new Set(candidates.map((c) => c.videoId));
    for (const suggestion of suggestions) {
      expect(validIds.has(suggestion.videoId)).toBe(true);
    }
    expect(new Set(suggestions.map((s) => s.kind)).size).toBe(3);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const candidates = [
      candidate({
        videoId: "11111111-1111-1111-1111-111111111111",
        updatedAt: NOW,
        masteryState: "basic",
        nextReviewAt: NOW - DAY_MS,
      }),
      candidate({
        videoId: "22222222-2222-2222-2222-222222222222",
        updatedAt: NOW - DAY_MS,
        masteryState: "expert",
      }),
      candidate({
        videoId: "33333333-3333-3333-3333-333333333333",
        updatedAt: NOW - 3 * DAY_MS,
        masteryState: "not_started",
      }),
    ];
    const first = selectWorkplaceSuggestions(candidates, NOW);
    const second = selectWorkplaceSuggestions(candidates, NOW);
    expect(second).toEqual(first);
  });
});
