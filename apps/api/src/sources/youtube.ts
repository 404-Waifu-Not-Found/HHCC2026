import { Innertube } from "youtubei.js/cf-worker";
import { z } from "zod";
import type { TranscriptSegment } from "@clipquest/contracts";
import { ApiError } from "../lib/errors";
import type { SourceAdapter, SourceVideo } from "./types";
import { parseYouTubeId } from "./url";

const YOUTUBE_INFO_CLIENT = "IOS" as const;
const YOUTUBE_CAPTION_CLIENTS = ["IOS", "ANDROID"] as const;
const MAX_WATCH_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_OEMBED_BYTES = 64 * 1024;
const MAX_AUDIO_BYTES = 180 * 1024 * 1024;

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

type TimedTextPayload = {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
};

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
      redirect: "manual",
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
      redirect: "manual",
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
    const results = await Promise.allSettled(
      YOUTUBE_CAPTION_CLIENTS.map(async (clientName) => {
        const info = await client.getBasicInfo(sourceVideoId, {
          client: clientName,
        });
        const title = info.basic_info.title?.trim();
        if (!title) return null;
        return {
          clientName,
          inspection: {
            title,
            durationSeconds: Math.max(
              0,
              Math.round(info.basic_info.duration ?? 0),
            ),
            thumbnails: info.basic_info.thumbnail ?? [],
            tracks: (info.captions?.caption_tracks ?? []).map((track) => {
              const kind =
                track.kind === "asr" || track.kind === "frc"
                  ? track.kind
                  : undefined;
              return {
                base_url: track.base_url,
                language_code: track.language_code,
                ...(kind ? { kind } : {}),
                label: track.name.toString(),
              };
            }),
          } satisfies YouTubeInspectionData,
        };
      }),
    );
    const candidates = results.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    console.info(
      JSON.stringify({
        scope: "youtube_captions",
        event: "innertube_clients.completed",
        sourceVideoId,
        clients: YOUTUBE_CAPTION_CLIENTS.map((clientName, index) => {
          const result = results[index];
          const candidate = candidates.find(
            (value) => value.clientName === clientName,
          );
          return {
            clientName,
            succeeded: result?.status === "fulfilled" && Boolean(result.value),
            captionTrackCount: candidate?.inspection.tracks.length ?? 0,
          };
        }),
      }),
    );
    return (
      candidates.sort(
        (a, b) => b.inspection.tracks.length - a.inspection.tracks.length,
      )[0]?.inspection ?? null
    );
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

export function parseYouTubeTimedText(
  payload: TimedTextPayload,
): TranscriptSegment[] {
  const segments = (payload.events ?? [])
    .slice(0, 12_000)
    .map((event, index) => {
      const startMs = Math.max(0, Math.floor(event.tStartMs ?? 0));
      const text = (event.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .replaceAll("\n", " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: `youtube-${index}-${startMs}`,
        startMs,
        endMs:
          startMs + Math.max(1, Math.floor(event.dDurationMs ?? 3_000)),
        text,
      };
    })
    .filter((segment) => segment.text.length > 0);
  const characters = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  return characters >= 20 ? segments : [];
}

function prepareCaptionSourceUrl(
  track: YouTubeCaptionTrack | undefined,
): string | undefined {
  if (!track) return undefined;
  try {
    const url = new URL(track.base_url);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "youtube.com" &&
        !url.hostname.endsWith(".youtube.com"))
    ) {
      return undefined;
    }
    url.searchParams.set("fmt", "json3");
    return url.toString();
  } catch {
    return undefined;
  }
}

function limitAudioStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytesRead = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_AUDIO_BYTES) {
        await reader.cancel("audio_too_large");
        controller.error(new Error("YouTube audio exceeded the safe limit."));
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
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

      const preferredTrack = selectPreferredYouTubeCaptionTrack(inspected.tracks);
      const preferredCaptionSourceUrl = prepareCaptionSourceUrl(preferredTrack);
      console.info(
        JSON.stringify({
          scope: "youtube_captions",
          event: preferredCaptionSourceUrl
            ? "browser_source.available"
            : "browser_source.unavailable",
          sourceVideoId,
          captionTrackCount: inspected.tracks.length,
          language: preferredTrack?.language_code ?? null,
        }),
      );
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
        ...(preferredCaptionSourceUrl
          ? { preferredCaptionSourceUrl }
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
  ): Promise<import("./types").AudioStream> {
    const startedAt = Date.now();
    try {
      const client = await createYouTubeClient(true);
      const info = await client.getInfo(sourceVideoId, {
        client: YOUTUBE_INFO_CLIENT,
      });
      const format = info.chooseFormat({
        type: "audio",
        quality: "bestefficiency",
      });
      if (!format.url) throw new Error("audio_url_missing");
      const declaredLength = Number(format.content_length ?? 0);
      if (declaredLength > MAX_AUDIO_BYTES) {
        throw new ApiError(
          422,
          "audio_too_large",
          "This video's audio is too large for browser transcription.",
        );
      }
      const headers = new Headers({
        Accept: "audio/*,*/*;q=0.8",
        "Cache-Control": "no-store",
      });
      const range = request.headers.get("range");
      if (range) headers.set("Range", range);
      const response = await fetch(format.url, { headers });
      if (!response.ok || !response.body)
        throw new Error(`audio_http_${response.status}`);
      const responseLength = Number(response.headers.get("content-length") ?? 0);
      if (responseLength > MAX_AUDIO_BYTES) {
        await response.body.cancel("audio_too_large");
        throw new ApiError(
          422,
          "audio_too_large",
          "This video's audio is too large for browser transcription.",
        );
      }
      console.info(
        JSON.stringify({
          scope: "youtube_audio",
          event: "stream.opened",
          sourceVideoId,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
        }),
      );
      return {
        body: limitAudioStream(response.body),
        contentType:
          response.headers.get("content-type") ??
          format.mime_type?.split(";")[0] ??
          "audio/mp4",
        ...(response.headers.get("content-length")
          ? { contentLength: response.headers.get("content-length")! }
          : {}),
        ...(response.headers.get("accept-ranges")
          ? { acceptRanges: response.headers.get("accept-ranges")! }
          : {}),
        ...(response.headers.get("content-range")
          ? { contentRange: response.headers.get("content-range")! }
          : {}),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.warn(
        JSON.stringify({
          scope: "youtube_audio",
          event: "stream.failed",
          sourceVideoId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          elapsedMs: Date.now() - startedAt,
        }),
      );
      throw new ApiError(
        503,
        "youtube_audio_unavailable",
        "YouTube audio is temporarily unavailable. Try again shortly.",
      );
    }
  }
}
