import type { TranscriptSegment } from "@clipquest/contracts";
import { Innertube } from "youtubei.js/cf-worker";
import { ApiError } from "../lib/errors";
import type { AudioStream, SourceAdapter, SourceVideo } from "./types";
import { parseYouTubeId } from "./url";

const YOUTUBE_INFO_CLIENTS = ["IOS", "ANDROID", "WEB"] as const;
const YOUTUBE_AUDIO_CLIENT = "IOS" as const;
const MAX_TIMED_TEXT_BYTES = 8 * 1024 * 1024;

type YouTubeCaptionTrack = {
  base_url: string;
  language_code: string;
  kind?: "asr" | "frc";
};

type YouTubeTimedTextEvent = {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: unknown;
};

async function createYouTubeClient(retrievePlayer: boolean): Promise<Innertube> {
  return Innertube.create({
    lang: "en",
    location: "US",
    retrieve_player: retrievePlayer,
    generate_session_locally: true,
    enable_session_cache: false,
  });
}

function getBestThumbnail(thumbnails: Array<{ url: string; width?: number }>): string {
  return [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";
}

function toFiniteMilliseconds(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function parseYouTubeTimedText(value: unknown): TranscriptSegment[] {
  if (!value || typeof value !== "object" || !("events" in value) || !Array.isArray(value.events)) return [];

  const parsed = value.events.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const event = candidate as YouTubeTimedTextEvent;
    const startMs = toFiniteMilliseconds(event.tStartMs);
    if (startMs === null || !Array.isArray(event.segs)) return [];
    const text = event.segs
      .flatMap((segment) => {
        if (!segment || typeof segment !== "object" || !("utf8" in segment) || typeof segment.utf8 !== "string") {
          return [];
        }
        return [segment.utf8];
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return [];
    return [{ index, startMs, durationMs: toFiniteMilliseconds(event.dDurationMs), text }];
  });

  return parsed.map((event, index) => {
    const nextStartMs = parsed[index + 1]?.startMs;
    const durationEndMs = event.durationMs && event.durationMs > 0 ? event.startMs + event.durationMs : null;
    const endMs = Math.max(
      event.startMs + 1,
      durationEndMs ?? (nextStartMs && nextStartMs > event.startMs ? nextStartMs : event.startMs + 1_000),
    );
    return { id: `yt-${event.index + 1}`, startMs: event.startMs, endMs, text: event.text };
  });
}

export function selectPreferredYouTubeCaptionTrack<T extends YouTubeCaptionTrack>(tracks: T[]): T | undefined {
  const languageRank = (languageCode: string): number => {
    const normalized = languageCode.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return 0;
    if (normalized === "zh" || normalized.startsWith("zh-")) return 1;
    return 2;
  };
  return [...tracks].sort((a, b) => {
    const languageDifference = languageRank(a.language_code) - languageRank(b.language_code);
    if (languageDifference !== 0) return languageDifference;
    return Number(a.kind === "asr") - Number(b.kind === "asr");
  })[0];
}

function isYouTubeTimedTextUrl(url: URL): boolean {
  return url.protocol === "https:" && (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"));
}

export async function loadYouTubeCaptionSegments(track: YouTubeCaptionTrack): Promise<TranscriptSegment[]> {
  let url: URL;
  try {
    url = new URL(track.base_url);
  } catch {
    throw new Error("YouTube returned an invalid timed-text URL.");
  }
  if (!isYouTubeTimedTextUrl(url)) throw new Error("YouTube returned an untrusted timed-text URL.");
  url.searchParams.set("fmt", "json3");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`YouTube timed text returned HTTP ${response.status}.`);
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TIMED_TEXT_BYTES) {
    throw new Error("YouTube timed text exceeded the size limit.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_TIMED_TEXT_BYTES) {
    throw new Error("YouTube timed text exceeded the size limit.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("YouTube returned malformed timed text.");
  }
  const segments = parseYouTubeTimedText(payload);
  if (segments.length === 0) throw new Error("YouTube timed text contained no usable segments.");
  return segments;
}

export class YouTubeAdapter implements SourceAdapter {
  async inspect(url: URL): Promise<SourceVideo> {
    const sourceVideoId = parseYouTubeId(url);
    try {
      const client = await createYouTubeClient(false);
      let info: Awaited<ReturnType<Innertube["getBasicInfo"]>> | undefined;
      let captionInfo: Awaited<ReturnType<Innertube["getBasicInfo"]>> | undefined;
      let bestScore = -1;
      for (const clientName of YOUTUBE_INFO_CLIENTS) {
        try {
          const candidate = await client.getBasicInfo(sourceVideoId, { client: clientName });
          if (candidate.basic_info.title?.trim()) {
            if (
              (candidate.captions?.caption_tracks?.length ?? 0) >
              (captionInfo?.captions?.caption_tracks?.length ?? 0)
            ) {
              captionInfo = candidate;
            }
            const score =
              Number(candidate.playability_status?.status === "OK") * 100 +
              Number((candidate.captions?.caption_tracks?.length ?? 0) > 0) * 10 +
              Number((candidate.basic_info.duration ?? 0) > 0) * 2 +
              Number((candidate.basic_info.thumbnail?.length ?? 0) > 0);
            if (score > bestScore) {
              info = candidate;
              bestScore = score;
            }
            if (
              candidate.playability_status?.status === "OK" &&
              (candidate.captions?.caption_tracks?.length ?? 0) > 0 &&
              (candidate.basic_info.duration ?? 0) > 0
            ) {
              break;
            }
          }
        } catch {
          // YouTube frequently retires individual client modes. Try the next supported client.
        }
      }
      if (!info?.basic_info.title?.trim()) throw new Error("YouTube returned incomplete video metadata.");
      const tracks = captionInfo?.captions?.caption_tracks ?? info.captions?.caption_tracks ?? [];
      const captionTracks = tracks.map((track) => ({
        language: track.language_code,
        label: track.name.toString(),
        isAutoGenerated: track.kind === "asr",
      }));

      let preferredCaptionSegments: TranscriptSegment[] | undefined;
      const preferredTrack = selectPreferredYouTubeCaptionTrack(tracks);
      if (preferredTrack) {
        try {
          preferredCaptionSegments = await loadYouTubeCaptionSegments(preferredTrack);
        } catch {
          console.warn("YouTube captions were listed but could not be loaded", { sourceVideoId });
        }
      }

      return {
        source: "youtube",
        sourceVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
        title: info.basic_info.title.trim(),
        thumbnailUrl:
          getBestThumbnail(info.basic_info.thumbnail ?? []) ||
          `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
        durationSeconds: Math.max(0, Math.round(info.basic_info.duration ?? 0)),
        sourceLanguage: preferredTrack?.language_code ?? tracks[0]?.language_code ?? null,
        captionTracks,
        ...(preferredCaptionSegments?.length ? { preferredCaptionSegments } : {}),
      };
    } catch (error) {
      console.error("YouTube inspection failed", error);
      throw new ApiError(502, "youtube_unavailable", "YouTube could not provide this video right now. Try again shortly.");
    }
  }

  async streamAudio(sourceVideoId: string, request: Request): Promise<AudioStream> {
    try {
      const client = await createYouTubeClient(true);
      const range = parseRange(request.headers.get("range"));
      const body = await client.download(sourceVideoId, {
        client: YOUTUBE_AUDIO_CLIENT,
        type: "audio",
        quality: "bestefficiency",
        format: "any",
        ...(range ? { range } : {}),
      });
      return {
        body,
        contentType: "audio/mp4",
        acceptRanges: "bytes",
      };
    } catch (error) {
      console.error("YouTube audio stream failed", error);
      throw new ApiError(502, "audio_stream_unavailable", "The audio stream could not be prepared.");
    }
  }
}

function parseRange(value: string | null): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d+)-(\d+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : undefined;
}
