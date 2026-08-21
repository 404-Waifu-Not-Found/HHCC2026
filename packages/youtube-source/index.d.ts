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
  acquisition: "youtube_local_ytdlp" | "youtube_text_provider";
};

export type ParsedYouTubeTranscript = Omit<
  YouTubeTranscript,
  | "videoId"
  | "title"
  | "characterCount"
  | "transcriptFingerprint"
  | "acquisition"
>;

export type YouTubeSourceAdapters = {
  fetch?: typeof globalThis.fetch;
  readLocalTranscript?: (
    videoId: string,
    preferredLanguage?: string,
    signal?: AbortSignal,
  ) => Promise<ParsedYouTubeTranscript>;
};

export function parseYouTubeVideoId(value: string): string;
export function normalizeTranscriptLanguage(
  language: string | null | undefined,
): string;
export function collapseAdjacentCaptionRepeats(text: string): string;
export function parseBrowserTranscript(
  body: string,
  expectedVideoId: string,
): ParsedYouTubeTranscript;
export function parseYouTubeJson3Transcript(
  body: string,
  language?: string,
): ParsedYouTubeTranscript;
export function readBoundedResponseText(
  response: Response,
  maximumBytes?: number,
): Promise<string>;
export function acquireYouTubeSource(
  rawUrl: string,
  options?: {
    preferredLanguage?: string;
    signal?: AbortSignal;
    localOnly?: boolean;
    preferLocalTranscript?: boolean;
    adapters?: YouTubeSourceAdapters;
  },
): Promise<YouTubeTranscript>;
