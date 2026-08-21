import {
  CaptionResolveResponseSchema,
  createTranscriptCompleteness,
  transcriptCompletenessMatches,
  type TranscriptCompleteness,
  type TranscriptSegment,
  type VideoImportResponse,
} from "@clipquest/contracts";
import { apiRequest } from "../lib/api";
import {
  downloadBrowserYouTubeTranscript,
  downloadYouTubeCaptions,
} from "./youtube-captions";

export type AcquiredTextTranscript = {
  segments: TranscriptSegment[];
  language: string;
  completeness: TranscriptCompleteness;
  acquisition:
    "server_captions" | "youtube_signed_captions" | "youtube_text_provider";
};

export async function acquireTextTranscript(
  imported: VideoImportResponse,
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<AcquiredTextTranscript | null> {
  if (imported.captions.preferredSegments?.length) {
    const completeness = imported.captions.preferredCompleteness;
    if (
      !completeness ||
      !transcriptCompletenessMatches(
        completeness,
        imported.captions.preferredSegments,
        imported.video.durationSeconds,
      )
    ) {
      throw new Error(
        "The caption source did not prove that it returned the complete subtitle text.",
      );
    }
    return {
      segments: imported.captions.preferredSegments,
      language: imported.video.sourceLanguage ?? "und",
      acquisition: "server_captions",
      completeness,
    };
  }
  if (imported.video.source !== "youtube") return null;

  if (imported.captions.browserSourceAvailable) {
    try {
      onProgress?.(0.15);
      const startedAt = Date.now();
      const source = await apiRequest(
        `/api/videos/${encodeURIComponent(imported.video.id)}/captions/resolve`,
        { method: "POST", signal },
        CaptionResolveResponseSchema,
      );
      const document = await downloadYouTubeCaptions(source.captionUrl, signal);
      const completeness = createTranscriptCompleteness(
        document.segments,
        imported.video.durationSeconds,
        document.sourceSegmentCount,
      );
      console.info(
        JSON.stringify({
          scope: "caption_acquisition",
          event: "signed_captions.completed",
          sourceVideoId: imported.video.sourceVideoId,
          sourceSegmentCount: document.sourceSegmentCount,
          segmentCount: document.segments.length,
          characterCount: completeness.characterCount,
          transcriptComplete: true,
          elapsedMs: Date.now() - startedAt,
        }),
      );
      if (document.segments.length) {
        return {
          segments: document.segments,
          language: source.language,
          acquisition: "youtube_signed_captions",
          completeness,
        };
      }
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(
        JSON.stringify({
          scope: "caption_acquisition",
          event: "signed_captions.failed",
          sourceVideoId: imported.video.sourceVideoId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  }

  if (imported.captions.browserLookupAvailable) {
    try {
      onProgress?.(0.4);
      const startedAt = Date.now();
      const transcript = await downloadBrowserYouTubeTranscript(
        imported.video.sourceVideoId,
        signal,
      );
      const completeness = createTranscriptCompleteness(
        transcript.segments,
        imported.video.durationSeconds,
        transcript.sourceSegmentCount,
      );
      console.info(
        JSON.stringify({
          scope: "caption_acquisition",
          event: "browser_text.completed",
          sourceVideoId: imported.video.sourceVideoId,
          sourceSegmentCount: transcript.sourceSegmentCount,
          segmentCount: transcript.segments.length,
          characterCount: completeness.characterCount,
          transcriptComplete: true,
          elapsedMs: Date.now() - startedAt,
        }),
      );
      return {
        segments: transcript.segments,
        language: transcript.language,
        acquisition: "youtube_text_provider",
        completeness,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(
        JSON.stringify({
          scope: "caption_acquisition",
          event: "browser_text.failed",
          sourceVideoId: imported.video.sourceVideoId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  }
  return null;
}
