import { describe, expect, it } from "vitest";
import {
  collapseAdjacentCaptionRepeats,
  parseBrowserTranscript,
  parseYouTubeTimedText,
} from "../src/transcription/youtube-captions";

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

  it("parses and verifies a browser transcript response", () => {
    expect(
      parseBrowserTranscript(
        `# Transcript: AP Calculus\n\nSource video: https://www.youtube.com/watch?v=TTsLhDHWopI\nLanguage: en (auto-generated) · Duration: 1:05\n\n## Transcript\n[0:02] slope fields show slope fields show the derivative at sample points\n\n[1:04] Euler's method estimates a solution curve`,
        "TTsLhDHWopI",
      ),
    ).toEqual({
      language: "en",
      sourceSegmentCount: 2,
      segments: [
        {
          id: "youtube-text-0-2000",
          startMs: 2_000,
          endMs: 64_000,
          text: "slope fields show the derivative at sample points",
        },
        {
          id: "youtube-text-1-64000",
          startMs: 64_000,
          endMs: 94_000,
          text: "Euler's method estimates a solution curve",
        },
      ],
    });
  });

  it("rejects transcript text attributed to a different video", () => {
    expect(() =>
      parseBrowserTranscript(
        "Source video: https://www.youtube.com/watch?v=AAAAAAAAAAA\nLanguage: en\n[0:00] This transcript belongs elsewhere.",
        "TTsLhDHWopI",
      ),
    ).toThrow("did not match");
  });

  it("collapses rolling auto-caption repetitions without removing pairs", () => {
    expect(
      collapseAdjacentCaptionRepeats(
        "differential equations unit seven differential equations unit seven differential equations unit seven very very useful",
      ),
    ).toBe("differential equations unit seven very very useful");
  });

  it("preserves every timed-text event beyond the old 12,000-event cutoff", () => {
    const eventCount = 12_005;
    const segments = parseYouTubeTimedText({
      events: Array.from({ length: eventCount }, (_, index) => ({
        tStartMs: index * 1_000,
        dDurationMs: 1_000,
        segs: [{ utf8: `complete caption ${index + 1}` }],
      })),
    });

    expect(segments).toHaveLength(eventCount);
    expect(segments.at(-1)?.text).toBe(`complete caption ${eventCount}`);
  });

  it("preserves every browser transcript line beyond the old 12,000-line cutoff", () => {
    const lineCount = 12_005;
    const lines = Array.from(
      { length: lineCount },
      (_, index) =>
        `[${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}] full subtitle line ${index + 1}`,
    ).join("\n");
    const transcript = parseBrowserTranscript(
      `Source video: https://www.youtube.com/watch?v=TTsLhDHWopI\nLanguage: en\n${lines}`,
      "TTsLhDHWopI",
    );

    expect(transcript.sourceSegmentCount).toBe(lineCount);
    expect(transcript.segments).toHaveLength(lineCount);
    expect(transcript.segments.at(-1)?.text).toBe(
      `full subtitle line ${lineCount}`,
    );
  });
});
