import { describe, expect, it } from "vitest";
import { parseYouTubeTimedText } from "../src/transcription/youtube-captions";

describe("YouTube browser captions", () => {
  it("normalizes YouTube json3 transcript events", () => {
    expect(
      parseYouTubeTimedText({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 1_500,
            segs: [{ utf8: "Differential " }, { utf8: "equations" }],
          },
          {
            tStartMs: 1_500,
            dDurationMs: 2_000,
            segs: [{ utf8: "\nmodel rates of change." }],
          },
          { tStartMs: 3_500, segs: [{ utf8: "   " }] },
        ],
      }),
    ).toEqual([
      {
        id: "youtube-0-0",
        startMs: 0,
        endMs: 1_500,
        text: "Differential equations",
      },
      {
        id: "youtube-1-1500",
        startMs: 1_500,
        endMs: 3_500,
        text: "model rates of change.",
      },
    ]);
  });
});
