import {
  VideoImportRequestSchema,
  VideoImportResponseSchema,
  type VideoSource,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { cacheThumbnail } from "../lib/thumbnail";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import { getSourceAdapter, normalizeSourceUrl } from "../sources";
import { fetchFreshYouTubeCaptions } from "../sources/youtube-captions";
import type { SourceVideo } from "../sources/types";
import { parseYouTubeId } from "../sources/url";
import { ApiError } from "../lib/errors";

type VideoRow = {
  id: string;
  source: VideoSource;
  source_video_id: string;
  original_url: string;
  title: string;
  thumbnail_key: string | null;
  thumbnail_remote_url: string;
  duration_seconds: number;
  source_language: string | null;
};

function youtubePipelineEnabled(value: string, userId: string): boolean {
  const percentage = value === "true" ? 100 : Number.parseInt(value, 10);
  if (!Number.isFinite(percentage) || percentage <= 0) return false;
  if (percentage >= 100) return true;
  let hash = 2166136261;
  for (const character of userId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < percentage;
}

export const videosRouter = new Hono<ApiBindings>();
export const thumbnailRouter = new Hono<ApiBindings>();

videosRouter.post("/import", async (c) => {
  const importStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "video-import",
    identifier: user.id,
    maximum: 20,
    windowSeconds: 60,
  });
  const input = await parseJson(c, VideoImportRequestSchema);
  const normalized = await normalizeSourceUrl(input.url);
  const sourceVideoId =
    normalized.source === "youtube"
      ? parseYouTubeId(normalized.url)
      : undefined;
  console.info(
    JSON.stringify({
      scope: "video_import",
      event: "request.accepted",
      requestId,
      source: normalized.source,
      sourceVideoId,
    }),
  );

  let inspected: SourceVideo;
  if (normalized.source === "youtube") {
    const providerAcquisitionEnabled = youtubePipelineEnabled(
      c.env.YOUTUBE_BROWSER_PIPELINE_V2,
      user.id,
    );
    const [metadataResult, captionResult] = await Promise.allSettled([
      getSourceAdapter("youtube").inspect(normalized.url),
      providerAcquisitionEnabled
        ? fetchFreshYouTubeCaptions(c.env, normalized.url.toString(), requestId)
        : Promise.resolve(null),
    ]);
    const captions =
      captionResult.status === "fulfilled" ? captionResult.value : null;
    if (metadataResult.status === "fulfilled") {
      inspected = metadataResult.value;
    } else if (captions?.metadata?.title && sourceVideoId) {
      inspected = {
        source: "youtube",
        sourceVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
        title: captions.metadata.title,
        thumbnailUrl:
          captions.metadata.thumbnailUrl ??
          `https://i.ytimg.com/vi/${sourceVideoId}/hqdefault.jpg`,
        durationSeconds: captions.metadata.durationSeconds ?? 0,
        sourceLanguage: captions.language,
        captionTracks: [],
      };
    } else {
      throw metadataResult.reason;
    }
    if (captions) {
      inspected = {
        ...inspected,
        title: captions.metadata?.title ?? inspected.title,
        thumbnailUrl: captions.metadata?.thumbnailUrl ?? inspected.thumbnailUrl,
        durationSeconds:
          captions.metadata?.durationSeconds ?? inspected.durationSeconds,
        sourceLanguage: captions.language ?? inspected.sourceLanguage,
        captionTracks: captions.tracks,
        preferredCaptionSegments: captions.segments,
      };
    }
    console.info(
      JSON.stringify({
        scope: "video_import",
        event: "youtube_acquisition.completed",
        requestId,
        sourceVideoId,
        provider: captions?.provider ?? "browser_tab_capture",
        providerAcquisitionEnabled,
        captionSegmentCount: captions?.segments.length ?? 0,
        elapsedMs: Date.now() - importStartedAt,
      }),
    );
  } else {
    const adapterStartedAt = Date.now();
    try {
      inspected = await getSourceAdapter(normalized.source).inspect(
        normalized.url,
      );
      console.info(
        JSON.stringify({
          scope: "video_import",
          event: "source_adapter.completed",
          requestId,
          source: normalized.source,
          sourceVideoId: inspected.sourceVideoId,
          elapsedMs: Date.now() - adapterStartedAt,
          captionTrackCount: inspected.captionTracks.length,
          captionSegmentCount: inspected.preferredCaptionSegments?.length ?? 0,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          scope: "video_import",
          event: "source_adapter.failed",
          requestId,
          source: normalized.source,
          sourceVideoId,
          elapsedMs: Date.now() - adapterStartedAt,
          errorCode: error instanceof ApiError ? error.code : "source_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      throw error;
    }
  }
  const existing = await c.env.DB.prepare(
    "SELECT id, source, source_video_id, original_url, title, thumbnail_key, thumbnail_remote_url, duration_seconds, source_language FROM videos WHERE owner_id = ? AND source = ? AND source_video_id = ?",
  )
    .bind(user.id, inspected.source, inspected.sourceVideoId)
    .first<VideoRow>();

  const timestamp = now();
  const videoId = existing?.id ?? createId();
  const durationSeconds =
    inspected.durationSeconds || existing?.duration_seconds || 0;
  const sourceLanguage =
    inspected.sourceLanguage ?? existing?.source_language ?? null;
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE videos SET original_url = ?, title = ?, thumbnail_remote_url = ?, duration_seconds = ?, source_language = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(
        inspected.canonicalUrl,
        inspected.title,
        inspected.thumbnailUrl,
        durationSeconds,
        sourceLanguage,
        timestamp,
        videoId,
        user.id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO videos (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        videoId,
        user.id,
        inspected.source,
        inspected.sourceVideoId,
        inspected.canonicalUrl,
        inspected.title,
        inspected.thumbnailUrl,
        durationSeconds,
        sourceLanguage,
        timestamp,
        timestamp,
      )
      .run();
  }

  c.executionCtx.waitUntil(
    cacheThumbnail(c.env, videoId, inspected.thumbnailUrl),
  );
  const preferredSegments = inspected.preferredCaptionSegments?.filter(
    (segment) => segment.text.trim().length > 0,
  );
  const response = VideoImportResponseSchema.parse({
    video: {
      id: videoId,
      source: inspected.source,
      sourceVideoId: inspected.sourceVideoId,
      title: inspected.title,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${videoId}/thumbnail`,
      durationSeconds,
      sourceLanguage,
    },
    captions: {
      available: Boolean(preferredSegments?.length),
      tracks: inspected.captionTracks,
      ...(preferredSegments?.length ? { preferredSegments } : {}),
    },
    transcriptionMode: preferredSegments?.length
      ? "captions"
      : inspected.source === "youtube"
        ? "browser_tab_capture"
        : "device_media",
    capture: {
      expectedDurationSeconds: durationSeconds,
      requiresUserGesture:
        inspected.source === "youtube" && !preferredSegments?.length,
    },
    requiresLocalTranscription: !preferredSegments?.length,
  });
  console.info(
    JSON.stringify({
      scope: "video_import",
      event: "request.completed",
      requestId,
      source: inspected.source,
      sourceVideoId: inspected.sourceVideoId,
      existingVideo: Boolean(existing),
      captionTrackCount: inspected.captionTracks.length,
      captionSegmentCount: preferredSegments?.length ?? 0,
      requiresLocalTranscription: !preferredSegments?.length,
      elapsedMs: Date.now() - importStartedAt,
    }),
  );
  return c.json(response, 201);
});

thumbnailRouter.get("/:videoId/thumbnail", async (c) => {
  const videoId = c.req.param("videoId");
  const video = await c.env.DB.prepare(
    "SELECT thumbnail_key, thumbnail_remote_url FROM videos WHERE id = ?",
  )
    .bind(videoId)
    .first<{ thumbnail_key: string | null; thumbnail_remote_url: string }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  if (video.thumbnail_key) {
    const object = await c.env.PRIVATE_BUCKET.get(video.thumbnail_key);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=604800",
      );
      return new Response(object.body, { headers });
    }
  }
  return Response.redirect(video.thumbnail_remote_url, 302);
});
