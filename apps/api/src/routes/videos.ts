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
  const user = c.get("user");
  await enforceRateLimit(c.env.CACHE, {
    namespace: "video-import",
    identifier: user.id,
    maximum: 20,
    windowSeconds: 60,
  });
  const input = await parseJson(c, VideoImportRequestSchema);
  const normalized = await normalizeSourceUrl(input.url);
  const inspected = await getSourceAdapter(normalized.source).inspect(normalized.url);
  const existing = await c.env.DB.prepare(
    "SELECT id, source, source_video_id, original_url, title, thumbnail_key, thumbnail_remote_url, duration_seconds, source_language FROM videos WHERE owner_id = ? AND source = ? AND source_video_id = ?",
  )
    .bind(user.id, inspected.source, inspected.sourceVideoId)
    .first<VideoRow>();

  const timestamp = now();
  const videoId = existing?.id ?? createId();
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE videos SET original_url = ?, title = ?, thumbnail_remote_url = ?, duration_seconds = ?, source_language = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(
        inspected.canonicalUrl,
        inspected.title,
        inspected.thumbnailUrl,
        inspected.durationSeconds,
        inspected.sourceLanguage,
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
        inspected.durationSeconds,
        inspected.sourceLanguage,
        timestamp,
        timestamp,
      )
      .run();
  }

  c.executionCtx.waitUntil(cacheThumbnail(c.env, videoId, inspected.thumbnailUrl));
  const preferredSegments = inspected.preferredCaptionSegments?.filter((segment) => segment.text.trim().length > 0);
  const response = VideoImportResponseSchema.parse({
    video: {
      id: videoId,
      source: inspected.source,
      sourceVideoId: inspected.sourceVideoId,
      title: inspected.title,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${videoId}/thumbnail`,
      durationSeconds: inspected.durationSeconds,
      sourceLanguage: inspected.sourceLanguage,
    },
    captions: {
      available: Boolean(preferredSegments?.length),
      tracks: inspected.captionTracks,
      ...(preferredSegments?.length ? { preferredSegments } : {}),
    },
    requiresLocalTranscription: !preferredSegments?.length,
  });
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
      headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return new Response(object.body, { headers });
    }
  }
  return Response.redirect(video.thumbnail_remote_url, 302);
});
