import type { TranscriptSegment } from "@clipquest/contracts";

export function assertTranscriptQuality(segments: TranscriptSegment[], durationSeconds: number): void {
  const characters = segments.reduce((total, segment) => total + segment.text.trim().length, 0);
  if (!segments.length || characters < Math.max(20, durationSeconds * 0.12)) {
    throw new Error("The local transcript was too uncertain to create a trustworthy quiz.");
  }
}
