import type { ProfileLearningStatsResponse } from "@clipquest/contracts";

export type DailyQuizCompletion =
  ProfileLearningStatsResponse["dailyQuizCompletions"][number];

export type ContributionDay = DailyQuizCompletion & { future: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildContributionWeeks(
  completions: DailyQuizCompletion[],
  today = new Date(),
): ContributionDay[][] {
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const rangeStart = todayUtc - 364 * DAY_MS;
  const start = rangeStart - new Date(rangeStart).getUTCDay() * DAY_MS;
  const end = todayUtc + (6 - new Date(todayUtc).getUTCDay()) * DAY_MS;
  const counts = new Map(completions.map((day) => [day.date, day.count]));
  const weeks: ContributionDay[][] = [];

  for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) {
    const weekIndex = Math.floor((timestamp - start) / (7 * DAY_MS));
    const date = new Date(timestamp).toISOString().slice(0, 10);
    (weeks[weekIndex] ??= []).push({
      date,
      count: counts.get(date) ?? 0,
      future: timestamp > todayUtc,
    });
  }
  return weeks;
}

export function intensityForCount(count: number): number {
  if (count <= 0) return 0;
  return Math.min(4, count);
}
