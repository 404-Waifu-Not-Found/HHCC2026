import type { TranscriptSegment } from "@clipquest/contracts";
import { Innertube } from "youtubei.js/cf-worker";
import { ApiError } from "../lib/errors";
import type { AudioStream, SourceAdapter, SourceVideo } from "./types";
import { parseYouTubeId } from "./url";

const YOUTUBE_INFO_CLIENT = "IOS" as const;
const YOUTUBE_AUDIO_CLIENT = "IOS" as const;
const MAX_TIMED_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_FALLBACK_BYTES = 8 * 1024 * 1024;
const MAX_WATCH_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_OEMBED_BYTES = 64 * 1024;

type YouTubeCaptionTrack = {
  base_url: string;
  language_code: string;
  kind?: "asr" | "frc";
  label?: string;
};

type YouTubeInspectionData = {
  title: string;
  durationSeconds: number;
  thumbnails: Array<{ url: string; width?: number }>;
  tracks: YouTubeCaptionTrack[];
};

type YouTubeTimedTextEvent = {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: unknown;
};

type YouTubeTranscriptFallback = {
  title: string;
  durationSeconds: number;
  languageCode: string;
  segments: TranscriptSegment[];
};

class YouTubeCaptionLoadError extends Error {
  constructor(readonly reason: string) {
    super("YouTube captions could not be loaded.");
  }
}

class YouTubeMetadataLoadError extends Error {
  constructor(readonly reason: string) {
    super("YouTube metadata could not be loaded.");
  }
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getYouTubeText(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.simpleText === "string") return record.simpleText.trim();
  if (!Array.isArray(record.runs)) return "";
  return record.runs
    .flatMap((run) => {
      const runRecord = asRecord(run);
      return typeof runRecord?.text === "string" ? [runRecord.text] : [];
    })
    .join("")
    .trim();
}

export function extractYouTubePlayerResponse(html: string): unknown | null {
  const markers = ["var ytInitialPlayerResponse = ", "ytInitialPlayerResponse = "];
  for (const marker of markers) {
    let markerIndex = html.indexOf(marker);
    while (markerIndex >= 0) {
      const start = html.indexOf("{", markerIndex + marker.length);
      if (start < 0 || start - markerIndex > marker.length + 32) break;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < html.length; index += 1) {
        const character = html[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === "{") depth += 1;
        else if (character === "}" && --depth === 0) {
          try {
            return JSON.parse(html.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
      markerIndex = html.indexOf(marker, markerIndex + marker.length);
    }
  }
  return null;
}

export function parseYouTubePlayerResponse(value: unknown): YouTubeInspectionData | null {
  const response = asRecord(value);
  const videoDetails = asRecord(response?.videoDetails);
  const title = typeof videoDetails?.title === "string" ? videoDetails.title.trim() : "";
  if (!title) return null;

  const rawDuration =
    typeof videoDetails?.lengthSeconds === "string" || typeof videoDetails?.lengthSeconds === "number"
      ? Number(videoDetails.lengthSeconds)
      : 0;
  const thumbnailContainer = asRecord(videoDetails?.thumbnail);
  const thumbnails = Array.isArray(thumbnailContainer?.thumbnails)
    ? thumbnailContainer.thumbnails.flatMap((thumbnail) => {
        const record = asRecord(thumbnail);
        if (typeof record?.url !== "string") return [];
        return [
          {
            url: record.url,
            ...(typeof record.width === "number" ? { width: record.width } : {}),
          },
        ];
      })
    : [];
  const captions = asRecord(response?.captions);
  const trackList = asRecord(captions?.playerCaptionsTracklistRenderer);
  const tracks = Array.isArray(trackList?.captionTracks)
    ? trackList.captionTracks.flatMap((track) => {
        const record = asRecord(track);
        if (typeof record?.baseUrl !== "string" || typeof record.languageCode !== "string") return [];
        const kind: YouTubeCaptionTrack["kind"] =
          record.kind === "asr" || record.kind === "frc" ? record.kind : undefined;
        return [
          {
            base_url: record.baseUrl,
            language_code: record.languageCode,
            ...(kind ? { kind } : {}),
            label: getYouTubeText(record.name) || record.languageCode,
          },
        ];
      })
    : [];
  return {
    title,
    durationSeconds: Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : 0,
    thumbnails,
    tracks,
  };
}

async function fetchYouTubeWatchPage(sourceVideoId: string): Promise<YouTubeInspectionData> {
  const watchUrl = new URL("https://www.youtube.com/watch");
  watchUrl.searchParams.set("v", sourceVideoId);
  watchUrl.searchParams.set("hl", "en");
  let response: Response;
  try {
    response = await fetch(watchUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      },
      redirect: "error",
    });
  } catch {
    throw new YouTubeMetadataLoadError("watch_fetch_failed");
  }
  if (!response.ok) throw new YouTubeMetadataLoadError(`watch_http_${response.status}`);
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WATCH_PAGE_BYTES) {
    throw new YouTubeMetadataLoadError("watch_oversize");
  }
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > MAX_WATCH_PAGE_BYTES) {
    throw new YouTubeMetadataLoadError("watch_oversize");
  }
  const parsed = parseYouTubePlayerResponse(extractYouTubePlayerResponse(html));
  if (!parsed) throw new YouTubeMetadataLoadError("watch_incomplete");
  return parsed;
}

async function fetchYouTubeOEmbed(sourceVideoId: string): Promise<YouTubeInspectionData> {
  const videoUrl = `https://www.youtube.com/watch?v=${sourceVideoId}`;
  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("url", videoUrl);
  oembedUrl.searchParams.set("format", "json");
  let response: Response;
  try {
    response = await fetch(oembedUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    throw new YouTubeMetadataLoadError("oembed_fetch_failed");
  }
  if (!response.ok) throw new YouTubeMetadataLoadError(`oembed_http_${response.status}`);
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OEMBED_BYTES) {
    throw new YouTubeMetadataLoadError("oembed_oversize");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_OEMBED_BYTES) {
    throw new YouTubeMetadataLoadError("oembed_oversize");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new YouTubeMetadataLoadError("oembed_malformed_json");
  }
  const record = asRecord(payload);
  const title = typeof record?.title === "string" ? record.title.trim() : "";
  if (!title) throw new YouTubeMetadataLoadError("oembed_incomplete");
  const thumbnailUrl = typeof record?.thumbnail_url === "string" ? record.thumbnail_url : "";
  return {
    title,
    durationSeconds: 0,
    thumbnails: thumbnailUrl ? [{ url: thumbnailUrl }] : [],
    tracks: [],
  };
}

function parseClock(value: string): number | null {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (hours === undefined || minutes === undefined || seconds === undefined || minutes > 59 || seconds > 59) {
    return null;
  }
  return hours * 3_600 + minutes * 60 + seconds;
}

export function parseYouTubeTranscriptMarkdown(
  sourceVideoId: string,
  markdown: string,
): YouTubeTranscriptFallback | null {
  const title =
    markdown
      .match(/^# Transcript:\s*(.+)$/m)?.[1]
      ?.trim()
      .slice(0, 500) ?? "";
  const source = markdown.match(/^Source video:\s*(\S+)$/m)?.[1];
  const durationValue = markdown.match(/^Language:.*?\bDuration:\s*([0-9:]+)/m)?.[1];
  const transcriptStart = markdown.indexOf("## Transcript");
  if (!title || !source || transcriptStart < 0) return null;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return null;
  }
  if (parseYouTubeId(sourceUrl) !== sourceVideoId) return null;

  const entries: Array<{ startMs: number; text: string }> = [];
  const body = markdown.slice(transcriptStart + "## Transcript".length);
  const timestampPattern =
    /\[(\d{1,3}:[0-5]\d(?::[0-5]\d)?)\]\s*([\s\S]*?)(?=\n+\[\d{1,3}:[0-5]\d(?::[0-5]\d)?\]|\s*$)/g;
  for (const match of body.matchAll(timestampPattern)) {
    const seconds = match[1] ? parseClock(match[1]) : null;
    const text = match[2]?.replace(/\s+/g, " ").trim() ?? "";
    if (seconds === null || !text) continue;
    entries.push({ startMs: seconds * 1_000, text });
  }
  if (entries.length === 0) return null;

  const declaredDuration = durationValue ? parseClock(durationValue) : null;
  const durationSeconds = Math.max(declaredDuration ?? 0, Math.ceil(entries.at(-1)!.startMs / 1_000));
  const segments = entries.map((entry, index) => {
    const nextStartMs = entries[index + 1]?.startMs;
    const declaredEndMs = durationSeconds * 1_000;
    const fallbackEndMs = entry.startMs + 30_000;
    const endMs = Math.max(
      entry.startMs + 1,
      nextStartMs ?? (declaredEndMs > entry.startMs ? declaredEndMs : fallbackEndMs),
    );
    return {
      id: `yt-fallback-${index + 1}`,
      startMs: entry.startMs,
      endMs,
      text: entry.text,
    };
  });

  return { title, durationSeconds, languageCode: "en", segments };
}

export async function loadYouTubeTranscriptFallback(sourceVideoId: string): Promise<YouTubeTranscriptFallback> {
  const fallbackUrl = new URL(`https://youtube-transcript.ai/transcript/${encodeURIComponent(sourceVideoId)}.txt`);
  fallbackUrl.searchParams.set("lang", "en");
  let response: Response;
  try {
    response = await fetch(fallbackUrl, {
      headers: { Accept: "text/markdown,text/plain;q=0.9" },
      redirect: "error",
    });
  } catch {
    throw new YouTubeCaptionLoadError("fallback_fetch_failed");
  }
  if (!response.ok) throw new YouTubeCaptionLoadError(`fallback_http_${response.status}`);
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSCRIPT_FALLBACK_BYTES) {
    throw new YouTubeCaptionLoadError("fallback_oversize");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_TRANSCRIPT_FALLBACK_BYTES) {
    throw new YouTubeCaptionLoadError("fallback_oversize");
  }
  const parsed = parseYouTubeTranscriptMarkdown(sourceVideoId, body);
  if (!parsed) throw new YouTubeCaptionLoadError("fallback_invalid");
  return parsed;
}

async function inspectWithInnerTube(sourceVideoId: string): Promise<YouTubeInspectionData | null> {
  try {
    const client = await createYouTubeClient(false);
    const info = await client.getBasicInfo(sourceVideoId, {
      client: YOUTUBE_INFO_CLIENT,
    });
    const title = info.basic_info.title?.trim();
    if (!title) return null;
    return {
      title,
      durationSeconds: Math.max(0, Math.round(info.basic_info.duration ?? 0)),
      thumbnails: info.basic_info.thumbnail ?? [],
      tracks: (info.captions?.caption_tracks ?? []).map((track) => {
        const kind = track.kind === "asr" || track.kind === "frc" ? track.kind : undefined;
        return {
          base_url: track.base_url,
          language_code: track.language_code,
          ...(kind ? { kind } : {}),
          label: track.name.toString(),
        };
      }),
    };
  } catch {
    return null;
  }
}

function mergeYouTubeInspection(
  primary: YouTubeInspectionData | null,
  fallback: YouTubeInspectionData,
): YouTubeInspectionData {
  if (!primary) return fallback;
  return {
    title: primary.title || fallback.title,
    durationSeconds: primary.durationSeconds || fallback.durationSeconds,
    thumbnails: primary.thumbnails.length > 0 ? primary.thumbnails : fallback.thumbnails,
    tracks: primary.tracks.length >= fallback.tracks.length ? primary.tracks : fallback.tracks,
  };
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
    return [
      {
        index,
        startMs,
        durationMs: toFiniteMilliseconds(event.dDurationMs),
        text,
      },
    ];
  });

  return parsed.map((event, index) => {
    const nextStartMs = parsed[index + 1]?.startMs;
    const durationEndMs = event.durationMs && event.durationMs > 0 ? event.startMs + event.durationMs : null;
    const endMs = Math.max(
      event.startMs + 1,
      durationEndMs ?? (nextStartMs && nextStartMs > event.startMs ? nextStartMs : event.startMs + 1_000),
    );
    return {
      id: `yt-${event.index + 1}`,
      startMs: event.startMs,
      endMs,
      text: event.text,
    };
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
    throw new YouTubeCaptionLoadError("invalid_url");
  }
  if (!isYouTubeTimedTextUrl(url)) throw new YouTubeCaptionLoadError("untrusted_url");
  url.searchParams.set("fmt", "json3");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    throw new YouTubeCaptionLoadError("fetch_failed");
  }
  if (!response.ok) throw new YouTubeCaptionLoadError(`http_${response.status}`);
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TIMED_TEXT_BYTES) {
    throw new YouTubeCaptionLoadError("oversize");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_TIMED_TEXT_BYTES) {
    throw new YouTubeCaptionLoadError("oversize");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new YouTubeCaptionLoadError("malformed_json");
  }
  const segments = parseYouTubeTimedText(payload);
  if (segments.length === 0) throw new YouTubeCaptionLoadError("empty_segments");
  return segments;
}

export class YouTubeAdapter implements SourceAdapter {
  async inspect(url: URL): Promise<SourceVideo> {
    const sourceVideoId = parseYouTubeId(url);
    try {
      let inspected = await inspectWithInnerTube(sourceVideoId);
      let transcriptFallback: YouTubeTranscriptFallback | null = null;
      let watchPageInspection: YouTubeInspectionData | null = null;
      let watchPageFailureReason: string | null = null;
      if (!inspected || inspected.tracks.length === 0) {
        try {
          watchPageInspection = await fetchYouTubeWatchPage(sourceVideoId);
          inspected = mergeYouTubeInspection(inspected, watchPageInspection);
        } catch (error) {
          watchPageFailureReason = error instanceof YouTubeMetadataLoadError ? error.reason : "watch_unexpected_error";
          // A usable InnerTube response is sufficient when the public watch page is temporarily unavailable.
        }
      }
      if (!inspected || inspected.tracks.length === 0) {
        try {
          transcriptFallback = await loadYouTubeTranscriptFallback(sourceVideoId);
          inspected ??= {
            title: transcriptFallback.title,
            durationSeconds: transcriptFallback.durationSeconds,
            thumbnails: [
              {
                url: `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
                width: 480,
              },
            ],
            tracks: [],
          };
        } catch {
          // Metadata-only fallbacks can still allow on-device transcription when captions are unavailable.
        }
      }
      if (!inspected) {
        try {
          inspected = await fetchYouTubeOEmbed(sourceVideoId);
        } catch (error) {
          console.warn("YouTube metadata fallbacks were exhausted", {
            sourceVideoId,
            watchPageFailureReason,
            oembedFailureReason: error instanceof YouTubeMetadataLoadError ? error.reason : "oembed_unexpected_error",
          });
          throw new Error("YouTube returned incomplete video metadata.");
        }
      }

      let preferredCaptionSegments: TranscriptSegment[] | undefined = transcriptFallback?.segments;
      let preferredTrack = selectPreferredYouTubeCaptionTrack(inspected.tracks);
      if (preferredTrack && !preferredCaptionSegments) {
        try {
          preferredCaptionSegments = await loadYouTubeCaptionSegments(preferredTrack);
        } catch (error) {
          try {
            watchPageInspection ??= await fetchYouTubeWatchPage(sourceVideoId);
            inspected = mergeYouTubeInspection(inspected, watchPageInspection);
            preferredTrack = selectPreferredYouTubeCaptionTrack(watchPageInspection.tracks);
            if (!preferredTrack) throw error;
            preferredCaptionSegments = await loadYouTubeCaptionSegments(preferredTrack);
          } catch (fallbackError) {
            console.warn("YouTube captions were listed but could not be loaded", {
              sourceVideoId,
              watchPageFailureReason:
                fallbackError instanceof YouTubeMetadataLoadError ? fallbackError.reason : watchPageFailureReason,
              reason:
                fallbackError instanceof YouTubeCaptionLoadError
                  ? fallbackError.reason
                  : error instanceof YouTubeCaptionLoadError
                    ? error.reason
                    : "unexpected_error",
            });
            try {
              transcriptFallback ??= await loadYouTubeTranscriptFallback(sourceVideoId);
              preferredCaptionSegments = transcriptFallback.segments;
            } catch {
              // The client can still fall back to on-device transcription.
            }
          }
        }
      }
      const captionTracks = inspected.tracks.map((track) => ({
        language: track.language_code,
        label: track.label || track.language_code,
        isAutoGenerated: track.kind === "asr",
      }));
      if (transcriptFallback && !captionTracks.some((track) => track.language === transcriptFallback.languageCode)) {
        captionTracks.push({
          language: transcriptFallback.languageCode,
          label: "English transcript",
          isAutoGenerated: false,
        });
      }

      return {
        source: "youtube",
        sourceVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
        title: inspected.title,
        thumbnailUrl: getBestThumbnail(inspected.thumbnails) || `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
        durationSeconds: inspected.durationSeconds,
        sourceLanguage:
          preferredTrack?.language_code ??
          transcriptFallback?.languageCode ??
          inspected.tracks[0]?.language_code ??
          null,
        captionTracks,
        ...(preferredCaptionSegments?.length ? { preferredCaptionSegments } : {}),
      };
    } catch (error) {
      console.error("YouTube inspection failed", error);
      throw new ApiError(
        502,
        "youtube_unavailable",
        "YouTube could not provide this video right now. Try again shortly.",
      );
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
      throw new ApiError(
        502,
        "audio_stream_unavailable",
        "YouTube temporarily blocked audio delivery. Retry shortly or try another video.",
      );
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
