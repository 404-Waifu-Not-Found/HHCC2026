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
import { loadCachedYouTubeSource } from "../sources/youtube";
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

export const videosRouter = new Hono<ApiBindings>();
export const thumbnailRouter = new Hono<ApiBindings>();

videosRouter.post("/import", async (c) => {
  const importStartedAt = Date.now();
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
      source: normalized.source,
      sourceVideoId,
    }),
  );

  let inspected: SourceVideo | null = null;
  let sourceCacheStatus: "hit" | "miss" | "error" | "not_applicable" =
    normalized.source === "youtube" ? "miss" : "not_applicable";
  if (normalized.source === "youtube") {
    const cacheStartedAt = Date.now();
    try {
      inspected = await loadCachedYouTubeSource(
        c.env.PRIVATE_BUCKET,
        normalized.url,
      );
      sourceCacheStatus = inspected ? "hit" : "miss";
      console.info(
        JSON.stringify({
          scope: "video_import",
          event: inspected ? "source_cache.hit" : "source_cache.miss",
          source: normalized.source,
          sourceVideoId,
          elapsedMs: Date.now() - cacheStartedAt,
        }),
      );
    } catch (error) {
      sourceCacheStatus = "error";
      console.error(
        JSON.stringify({
          scope: "video_import",
          event: "source_cache.failed",
          source: normalized.source,
          sourceVideoId,
          elapsedMs: Date.now() - cacheStartedAt,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  }

  if (!inspected) {
    const adapterStartedAt = Date.now();
    try {
      inspected = await getSourceAdapter(normalized.source).inspect(
        normalized.url,
      );
      console.info(
        JSON.stringify({
          scope: "video_import",
          event: "source_adapter.completed",
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
    requiresLocalTranscription: !preferredSegments?.length,
  });
  console.info(
    JSON.stringify({
      scope: "video_import",
      event: "request.completed",
      source: inspected.source,
      sourceVideoId: inspected.sourceVideoId,
      cacheStatus: sourceCacheStatus,
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
