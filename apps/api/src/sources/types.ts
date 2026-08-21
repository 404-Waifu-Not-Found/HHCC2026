import type { CaptionTrack, TranscriptSegment, VideoSource } from "@clipquest/contracts";

export type SourceVideo = {
  source: VideoSource;
  sourceVideoId: string;
  canonicalUrl: string;
  title: string;
  thumbnailUrl: string;
  durationSeconds: number;
  sourceLanguage: string | null;
  captionTracks: CaptionTrack[];
  preferredCaptionSegments?: TranscriptSegment[];
};

export type AudioStream = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: string;
  acceptRanges?: string;
  contentRange?: string;
};

export interface SourceAdapter {
  inspect(url: URL): Promise<SourceVideo>;
  streamAudio(sourceVideoId: string, request: Request): Promise<AudioStream>;
}

