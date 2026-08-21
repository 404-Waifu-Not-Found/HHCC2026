import type { TranscriptSegment } from "@clipquest/contracts";
import { describe, expect, it } from "vitest";
import { assertTranscriptQuality } from "../src/transcription/quality";

const segment = (text: string): TranscriptSegment => ({ id: "segment-1", startMs: 0, endMs: 1_000, text });

describe("local transcript quality gate", () => {
  it("accepts a useful short transcript", () => {
    expect(() => assertTranscriptQuality([segment("Photosynthesis turns light energy into chemical energy.")], 60)).not.toThrow();
  });

  it("rejects empty or implausibly sparse transcripts", () => {
    expect(() => assertTranscriptQuality([], 60)).toThrow(/trustworthy quiz/i);
    expect(() => assertTranscriptQuality([segment("few words")], 600)).toThrow(/trustworthy quiz/i);
  });

  it("does not count surrounding whitespace as speech", () => {
    expect(() => assertTranscriptQuality([segment("                    ")], 30)).toThrow(/trustworthy quiz/i);
  });
});
