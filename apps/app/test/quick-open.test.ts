import { describe, expect, it } from "vitest";
import { parseQuickOpenRequest } from "../src/lib/quick-open";

describe("ClipQuest quick open", () => {
  it("accepts a valid autostart YouTube handoff", () => {
    expect(
      parseQuickOpenRequest({
        url: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
        autostart: "1",
      }),
    ).toEqual({
      url: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
      autostart: "1",
    });
  });

  it("rejects unsupported, incomplete, and non-autostart requests", () => {
    expect(
      parseQuickOpenRequest({
        url: "https://example.com/video",
        autostart: "1",
      }),
    ).toBeNull();
    expect(
      parseQuickOpenRequest({
        url: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
      }),
    ).toBeNull();
    expect(parseQuickOpenRequest({ autostart: "1" })).toBeNull();
  });
});
