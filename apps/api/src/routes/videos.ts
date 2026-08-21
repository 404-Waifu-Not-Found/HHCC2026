import {
  CaptionResolveResponseSchema,
  VerifiedVideoMetadataRequestSchema,
  VerifiedVideoMetadataResponseSchema,
  VideoImportRequestSchema,
  VideoImportResponseSchema,
  type VideoSource,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import {
  cacheThumbnail,
  thumbnailCacheKey,
  THUMBNAIL_RETRY_AFTER_SECONDS,
} from "../lib/thumbnail";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import { getSourceAdapter, normalizeSourceUrl } from "../sources";
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

videosRouter.patch("/:videoId/source-metadata", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "video-source-metadata",
    identifier: user.id,
    maximum: 30,
    windowSeconds: 60,
  });
  const input = await parseJson(c, VerifiedVideoMetadataRequestSchema);
  const videoId = c.req.param("videoId");
  const timestamp = now();
  const result = await c.env.DB.prepare(
    `UPDATE videos
     SET duration_seconds = ?, source_language = ?, caption_source_category = ?, caption_segment_count = ?, caption_word_count = ?, source_metadata_verified_at = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(
      input.durationSeconds,
      input.sourceLanguage.toLocaleLowerCase("en-US"),
      input.captionSourceCategory,
      input.captionSegmentCount,
      input.captionWordCount,
      timestamp,
      timestamp,
      videoId,
      user.id,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(404, "video_not_found", "Video not found.");
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    VerifiedVideoMetadataResponseSchema.parse({ videoId, verified: true }),
  );
});

videosRouter.get("/:videoId/recovery", async (c) => {
  const user = c.get("user");
  const videoId = c.req.param("videoId");
  const video = await c.env.DB.prepare(
    "SELECT id, source, source_video_id, title, duration_seconds, source_language FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(videoId, user.id)
    .first<
      Pick<
        VideoRow,
        | "id"
        | "source"
        | "source_video_id"
        | "title"
        | "duration_seconds"
        | "source_language"
      >
    >();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  c.header("Cache-Control", "no-store");
  return c.json(
    VideoImportResponseSchema.parse({
      video: {
        id: video.id,
        source: video.source,
        sourceVideoId: video.source_video_id,
        title: video.title,
        thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${video.id}/thumbnail`,
        durationSeconds: video.duration_seconds,
        sourceLanguage: video.source_language,
      },
      captions: {
        available: true,
        tracks: [],
        browserSourceAvailable: false,
        browserLookupAvailable: true,
      },
      transcriptionMode: "captions",
      capture: {
        expectedDurationSeconds: video.duration_seconds,
        requiresUserGesture: false,
      },
      requiresLocalTranscription: false,
    }),
  );
});

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
  const sourceVideoId = parseYouTubeId(normalized.url);
  console.info(
    JSON.stringify({
      scope: "video_import",
      event: "request.accepted",
      requestId,
      source: normalized.source,
      sourceVideoId,
    }),
  );

  const inspected: SourceVideo = await getSourceAdapter("youtube").inspect(
    normalized.url,
  );
  console.info(
    JSON.stringify({
      scope: "video_import",
      event: "youtube_acquisition.completed",
      requestId,
      sourceVideoId,
      acquisition: inspected.preferredCaptionSegments?.length
        ? "server_captions"
        : inspected.preferredCaptionSourceUrl
          ? "browser_captions"
          : "transient_audio_stream",
      captionSegmentCount: inspected.preferredCaptionSegments?.length ?? 0,
      elapsedMs: Date.now() - importStartedAt,
    }),
  );
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
    cacheThumbnail(c.env, {
      videoId,
      sourceVideoId: inspected.sourceVideoId,
      remoteUrl: inspected.thumbnailUrl,
    }).then(() => undefined),
  );
  const preferredSegments = inspected.preferredCaptionSegments?.filter(
    (segment) => segment.text.trim().length > 0,
  );
  const browserCaptionLookup = Boolean(inspected.preferredCaptionSourceUrl);
  const browserTextLookupAvailable = true;
  const captionsAvailable = Boolean(
    preferredSegments?.length ||
    inspected.preferredCaptionSourceUrl ||
    browserCaptionLookup ||
    browserTextLookupAvailable,
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
      available: captionsAvailable,
      tracks: inspected.captionTracks,
      ...(preferredSegments?.length ? { preferredSegments } : {}),
      ...(preferredSegments?.length && inspected.preferredCaptionCompleteness
        ? {
            preferredCompleteness: inspected.preferredCaptionCompleteness,
          }
        : {}),
      browserSourceAvailable: browserCaptionLookup,
      browserLookupAvailable: browserTextLookupAvailable,
    },
    transcriptionMode: captionsAvailable ? "captions" : "device_media",
    capture: {
      expectedDurationSeconds: durationSeconds,
      requiresUserGesture: false,
    },
    requiresLocalTranscription: !captionsAvailable,
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
      browserCaptionSourceAvailable: browserCaptionLookup,
      browserTextLookupAvailable,
      requiresLocalTranscription: !captionsAvailable,
      elapsedMs: Date.now() - importStartedAt,
    }),
  );
  return c.json(response, 201);
});

videosRouter.post("/:videoId/captions/resolve", async (c) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const user = c.get("user");
  const videoId = c.req.param("videoId");
  const video = await c.env.DB.prepare(
    "SELECT source, source_video_id, original_url FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(videoId, user.id)
    .first<{
      source: VideoSource;
      source_video_id: string;
      original_url: string;
    }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");
  if (video.source !== "youtube") {
    throw new ApiError(
      422,
      "caption_source_unsupported",
      "Browser caption download is available for YouTube videos only.",
    );
  }
  let inspected = await getSourceAdapter("youtube").inspect(
    new URL(video.original_url),
  );
  for (
    let attempt = 2;
    attempt <= 3 && !inspected.preferredCaptionSourceUrl;
    attempt += 1
  ) {
    console.info(
      JSON.stringify({
        scope: "youtube_captions",
        event: "browser_resolve.retrying",
        requestId,
        sourceVideoId: video.source_video_id,
        attempt: attempt - 1,
      }),
    );
    inspected = await getSourceAdapter("youtube").inspect(
      new URL(video.original_url),
    );
  }
  if (!inspected.preferredCaptionSourceUrl || !inspected.sourceLanguage) {
    console.info(
      JSON.stringify({
        scope: "youtube_captions",
        event: "browser_resolve.unavailable",
        requestId,
        sourceVideoId: video.source_video_id,
        elapsedMs: Date.now() - startedAt,
      }),
    );
    throw new ApiError(
      404,
      "youtube_captions_unavailable",
      "YouTube did not provide captions for this video.",
    );
  }
  const response = CaptionResolveResponseSchema.parse({
    captionUrl: inspected.preferredCaptionSourceUrl,
    format: "json3",
    language: inspected.sourceLanguage,
  });
  c.header("Cache-Control", "no-store");
  console.info(
    JSON.stringify({
      scope: "youtube_captions",
      event: "browser_resolve.completed",
      requestId,
      sourceVideoId: video.source_video_id,
      language: inspected.sourceLanguage,
      elapsedMs: Date.now() - startedAt,
    }),
  );
  return c.json(response);
});

thumbnailRouter.get("/:videoId/thumbnail", async (c) => {
  const videoId = c.req.param("videoId");
  const video = await c.env.DB.prepare(
    "SELECT source_video_id, thumbnail_key, thumbnail_remote_url FROM videos WHERE id = ?",
  )
    .bind(videoId)
    .first<{
      source_video_id: string;
      thumbnail_key: string | null;
      thumbnail_remote_url: string;
    }>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");

  const deterministicKey = thumbnailCacheKey(videoId);
  const storedKey = video.thumbnail_key ?? deterministicKey;
  let object = await c.env.PRIVATE_BUCKET.get(storedKey);
  if (!object && storedKey !== deterministicKey) {
    object = await c.env.PRIVATE_BUCKET.get(deterministicKey);
  }
  if (object) {
    if (video.thumbnail_key !== object.key) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          "UPDATE videos SET thumbnail_key = ?, updated_at = ? WHERE id = ?",
        )
          .bind(object.key, Date.now(), videoId)
          .run()
          .then(() => undefined),
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Length", String(object.size));
    headers.set("ETag", object.httpEtag);
    headers.set(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    console.info(
      JSON.stringify({
        scope: "thumbnail",
        event: "cache_hit",
        videoId,
        sourceVideoId: video.source_video_id,
        bytes: object.size,
      }),
    );
    return new Response(object.body, { headers });
  }

  const acquired = await cacheThumbnail(c.env, {
    videoId,
    sourceVideoId: video.source_video_id,
    remoteUrl: video.thumbnail_remote_url,
  });
  if (acquired.ok) {
    const headers = new Headers({
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Length": String(acquired.bytes.byteLength),
      "Content-Type": acquired.contentType,
    });
    if (acquired.etag) headers.set("ETag", acquired.etag);
    return new Response(acquired.bytes, { headers });
  }

  return new Response(null, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(THUMBNAIL_RETRY_AFTER_SECONDS),
    },
  });
});
