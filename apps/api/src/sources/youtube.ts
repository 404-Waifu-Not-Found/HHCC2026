import {
  CaptionTrackSchema,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { Innertube } from "youtubei.js/cf-worker";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import type { AudioStream, SourceAdapter, SourceVideo } from "./types";
import { parseYouTubeId } from "./url";

const YOUTUBE_INFO_CLIENT = "IOS" as const;
const YOUTUBE_AUDIO_CLIENT = "IOS" as const;
const MAX_TIMED_TEXT_BYTES = 8 * 1024 * 1024;
const YOUTUBE_SOURCE_CACHE_PREFIX = "source-cache/youtube";
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

async function createYouTubeClient(
  retrievePlayer: boolean,
): Promise<Innertube> {
  return Innertube.create({
    lang: "en",
    location: "US",
    retrieve_player: retrievePlayer,
    generate_session_locally: true,
    enable_session_cache: false,
  });
}

function getBestThumbnail(
  thumbnails: Array<{ url: string; width?: number }>,
): string {
  return (
    [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ??
    ""
  );
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
  const markers = [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
  ];
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

export function parseYouTubePlayerResponse(
  value: unknown,
): YouTubeInspectionData | null {
  const response = asRecord(value);
  const videoDetails = asRecord(response?.videoDetails);
  const title =
    typeof videoDetails?.title === "string" ? videoDetails.title.trim() : "";
  if (!title) return null;

  const rawDuration =
    typeof videoDetails?.lengthSeconds === "string" ||
    typeof videoDetails?.lengthSeconds === "number"
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
            ...(typeof record.width === "number"
              ? { width: record.width }
              : {}),
          },
        ];
      })
    : [];
  const captions = asRecord(response?.captions);
  const trackList = asRecord(captions?.playerCaptionsTracklistRenderer);
  const tracks = Array.isArray(trackList?.captionTracks)
    ? trackList.captionTracks.flatMap((track) => {
        const record = asRecord(track);
        if (
          typeof record?.baseUrl !== "string" ||
          typeof record.languageCode !== "string"
        )
          return [];
        const kind: YouTubeCaptionTrack["kind"] =
          record.kind === "asr" || record.kind === "frc"
            ? record.kind
            : undefined;
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
    durationSeconds:
      Number.isFinite(rawDuration) && rawDuration >= 0
        ? Math.round(rawDuration)
        : 0,
    thumbnails,
    tracks,
  };
}

async function fetchYouTubeWatchPage(
  sourceVideoId: string,
): Promise<YouTubeInspectionData> {
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
  if (!response.ok)
    throw new YouTubeMetadataLoadError(`watch_http_${response.status}`);
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_WATCH_PAGE_BYTES
  ) {
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

async function fetchYouTubeOEmbed(
  sourceVideoId: string,
): Promise<YouTubeInspectionData> {
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
  if (!response.ok)
    throw new YouTubeMetadataLoadError(`oembed_http_${response.status}`);
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
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
  const thumbnailUrl =
    typeof record?.thumbnail_url === "string" ? record.thumbnail_url : "";
  return {
    title,
    durationSeconds: 0,
    thumbnails: thumbnailUrl ? [{ url: thumbnailUrl }] : [],
    tracks: [],
  };
}

async function inspectWithInnerTube(
  sourceVideoId: string,
): Promise<YouTubeInspectionData | null> {
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
        const kind =
          track.kind === "asr" || track.kind === "frc" ? track.kind : undefined;
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
    thumbnails:
      primary.thumbnails.length > 0 ? primary.thumbnails : fallback.thumbnails,
    tracks:
      primary.tracks.length >= fallback.tracks.length
        ? primary.tracks
        : fallback.tracks,
  };
}

function toFiniteMilliseconds(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function parseYouTubeTimedText(value: unknown): TranscriptSegment[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("events" in value) ||
    !Array.isArray(value.events)
  )
    return [];

  const parsed = value.events.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const event = candidate as YouTubeTimedTextEvent;
    const startMs = toFiniteMilliseconds(event.tStartMs);
    if (startMs === null || !Array.isArray(event.segs)) return [];
    const text = event.segs
      .flatMap((segment) => {
        if (
          !segment ||
          typeof segment !== "object" ||
          !("utf8" in segment) ||
          typeof segment.utf8 !== "string"
        ) {
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
    const durationEndMs =
      event.durationMs && event.durationMs > 0
        ? event.startMs + event.durationMs
        : null;
    const endMs = Math.max(
      event.startMs + 1,
      durationEndMs ??
        (nextStartMs && nextStartMs > event.startMs
          ? nextStartMs
          : event.startMs + 1_000),
    );
    return {
      id: `yt-${event.index + 1}`,
      startMs: event.startMs,
      endMs,
      text: event.text,
    };
  });
}

const CachedYouTubeSourceSchema = z.object({
  sourceVideoId: z.string().regex(/^[a-zA-Z0-9_-]{6,20}$/),
  title: z.string().trim().min(1).max(500),
  durationSeconds: z.number().int().nonnegative(),
  captionTrack: CaptionTrackSchema,
  timedText: z.unknown(),
});

export async function loadCachedYouTubeSource(
  bucket: R2Bucket,
  url: URL,
): Promise<SourceVideo | null> {
  const sourceVideoId = parseYouTubeId(url);
  const object = await bucket.get(
    `${YOUTUBE_SOURCE_CACHE_PREFIX}/${sourceVideoId}.json`,
  );
  if (!object || object.size > MAX_TIMED_TEXT_BYTES) return null;

  try {
    const cached = CachedYouTubeSourceSchema.safeParse(
      await object.json<unknown>(),
    );
    if (!cached.success || cached.data.sourceVideoId !== sourceVideoId)
      return null;
    const segments = parseYouTubeTimedText(cached.data.timedText);
    if (!segments.length) return null;

    return {
      source: "youtube",
      sourceVideoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
      title: cached.data.title,
      thumbnailUrl: `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
      durationSeconds: cached.data.durationSeconds,
      sourceLanguage: cached.data.captionTrack.language,
      captionTracks: [cached.data.captionTrack],
      preferredCaptionSegments: segments,
    };
  } catch {
    return null;
  }
}

export function selectPreferredYouTubeCaptionTrack<
  T extends YouTubeCaptionTrack,
>(tracks: T[]): T | undefined {
  const languageRank = (languageCode: string): number => {
    const normalized = languageCode.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return 0;
    if (normalized === "zh" || normalized.startsWith("zh-")) return 1;
    return 2;
  };
  return [...tracks].sort((a, b) => {
    const languageDifference =
      languageRank(a.language_code) - languageRank(b.language_code);
    if (languageDifference !== 0) return languageDifference;
    return Number(a.kind === "asr") - Number(b.kind === "asr");
  })[0];
}

function isYouTubeTimedTextUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))
  );
}

export async function loadYouTubeCaptionSegments(
  track: YouTubeCaptionTrack,
): Promise<TranscriptSegment[]> {
  let url: URL;
  try {
    url = new URL(track.base_url);
  } catch {
    throw new YouTubeCaptionLoadError("invalid_url");
  }
  if (!isYouTubeTimedTextUrl(url))
    throw new YouTubeCaptionLoadError("untrusted_url");
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
  if (!response.ok)
    throw new YouTubeCaptionLoadError(`http_${response.status}`);
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_TIMED_TEXT_BYTES
  ) {
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
  if (segments.length === 0)
    throw new YouTubeCaptionLoadError("empty_segments");
  return segments;
}

export class YouTubeAdapter implements SourceAdapter {
  async inspect(url: URL): Promise<SourceVideo> {
    const sourceVideoId = parseYouTubeId(url);
    try {
      let inspected = await inspectWithInnerTube(sourceVideoId);
      let watchPageInspection: YouTubeInspectionData | null = null;
      let watchPageFailureReason: string | null = null;
      if (!inspected || inspected.tracks.length === 0) {
        try {
          watchPageInspection = await fetchYouTubeWatchPage(sourceVideoId);
          inspected = mergeYouTubeInspection(inspected, watchPageInspection);
        } catch (error) {
          watchPageFailureReason =
            error instanceof YouTubeMetadataLoadError
              ? error.reason
              : "watch_unexpected_error";
          // A usable InnerTube response is sufficient when the public watch page is temporarily unavailable.
        }
      }
      if (!inspected) {
        try {
          inspected = await fetchYouTubeOEmbed(sourceVideoId);
        } catch (error) {
          console.warn("YouTube metadata fallbacks were exhausted", {
            sourceVideoId,
            watchPageFailureReason,
            oembedFailureReason:
              error instanceof YouTubeMetadataLoadError
                ? error.reason
                : "oembed_unexpected_error",
          });
          throw new Error("YouTube returned incomplete video metadata.");
        }
      }

      let preferredCaptionSegments: TranscriptSegment[] | undefined;
      let preferredTrack = selectPreferredYouTubeCaptionTrack(inspected.tracks);
      if (preferredTrack) {
        try {
          preferredCaptionSegments =
            await loadYouTubeCaptionSegments(preferredTrack);
        } catch (error) {
          try {
            watchPageInspection ??= await fetchYouTubeWatchPage(sourceVideoId);
            inspected = mergeYouTubeInspection(inspected, watchPageInspection);
            preferredTrack = selectPreferredYouTubeCaptionTrack(
              watchPageInspection.tracks,
            );
            if (!preferredTrack) throw error;
            preferredCaptionSegments =
              await loadYouTubeCaptionSegments(preferredTrack);
          } catch (fallbackError) {
            console.warn(
              "YouTube captions were listed but could not be loaded",
              {
                sourceVideoId,
                watchPageFailureReason:
                  fallbackError instanceof YouTubeMetadataLoadError
                    ? fallbackError.reason
                    : watchPageFailureReason,
                reason:
                  fallbackError instanceof YouTubeCaptionLoadError
                    ? fallbackError.reason
                    : error instanceof YouTubeCaptionLoadError
                      ? error.reason
                      : "unexpected_error",
              },
            );
            // The client can still fall back to on-device transcription.
          }
        }
      }
      const captionTracks = inspected.tracks.map((track) => ({
        language: track.language_code,
        label: track.label || track.language_code,
        isAutoGenerated: track.kind === "asr",
      }));
      return {
        source: "youtube",
        sourceVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
        title: inspected.title,
        thumbnailUrl:
          getBestThumbnail(inspected.thumbnails) ||
          `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
        durationSeconds: inspected.durationSeconds,
        sourceLanguage:
          preferredTrack?.language_code ??
          inspected.tracks[0]?.language_code ??
          null,
        captionTracks,
        ...(preferredCaptionSegments?.length
          ? { preferredCaptionSegments }
          : {}),
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

  async streamAudio(
    sourceVideoId: string,
    request: Request,
  ): Promise<AudioStream> {
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

function parseRange(
  value: string | null,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d+)-(\d+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? { start, end }
    : undefined;
}
