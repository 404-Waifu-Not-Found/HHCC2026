import type { TranscriptSegment } from "@clipquest/contracts";

export type YouTubeTranscript = {
  videoId: string;
  title: string;
  language: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  sourceSegmentCount: number;
  characterCount: number;
  transcriptFingerprint: string;
  acquisition: "youtube_text_provider";
};

export type YouTubeSourceAdapters = {
  fetch?: typeof globalThis.fetch;
};

export function parseYouTubeVideoId(value: string): string;
export function normalizeTranscriptLanguage(
  language: string | null | undefined,
): string;
export function collapseAdjacentCaptionRepeats(text: string): string;
export function parseBrowserTranscript(
  body: string,
  expectedVideoId: string,
): Omit<
  YouTubeTranscript,
  | "videoId"
  | "title"
  | "characterCount"
  | "transcriptFingerprint"
  | "acquisition"
>;
export function readBoundedResponseText(
  response: Response,
  maximumBytes?: number,
): Promise<string>;
export function acquireYouTubeSource(
  rawUrl: string,
  options?: {
    preferredLanguage?: string;
    signal?: AbortSignal;
    adapters?: YouTubeSourceAdapters;
  },
): Promise<YouTubeTranscript>;
