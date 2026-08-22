import { describe, expect, it } from "vitest";
import {
  buildContributionWeeks,
  intensityForCount,
} from "../src/lib/quiz-contributions";

describe("quiz contribution calendar", () => {
  it("builds a Sunday-aligned 53-week history ending in the current week", () => {
    const weeks = buildContributionWeeks(
      [
        { date: "2026-08-20", count: 2 },
        { date: "2026-08-21", count: 1 },
      ],
      new Date("2026-08-22T12:00:00Z"),
    );

    expect(weeks).toHaveLength(53);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.[0]?.date).toBe("2025-08-17");
    expect(weeks.at(-1)?.at(-1)?.date).toBe("2026-08-22");
    expect(weeks.flat().find((day) => day.date === "2026-08-20")?.count).toBe(
      2,
    );
  });

  it("fills future days without treating them as contributions", () => {
    const weeks = buildContributionWeeks(
      [{ date: "2026-08-20", count: 4 }],
      new Date("2026-08-20T12:00:00Z"),
    );
    const finalWeek = weeks.at(-1);

    expect(finalWeek?.find((day) => day.date === "2026-08-20")?.future).toBe(
      false,
    );
    expect(finalWeek?.find((day) => day.date === "2026-08-22")?.future).toBe(
      true,
    );
  });

  it("uses stable intensity buckets with a four-quiz ceiling", () => {
    expect([0, 1, 2, 3, 4, 12].map(intensityForCount)).toEqual([
      0, 1, 2, 3, 4, 4,
    ]);
  });
});
