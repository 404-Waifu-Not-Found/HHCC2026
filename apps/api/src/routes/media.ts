import {
  MediaResolveRequestSchema,
  MediaResolveResponseSchema,
  SourceSchema,
  type VideoSource,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";
import { getSourceAdapter } from "../sources";
import type { MediaToken } from "../types";

const MEDIA_TTL_SECONDS = 10 * 60;
const MAX_CAPTIONLESS_DURATION_SECONDS = 90 * 60;
export const MEDIA_TOKEN_MAX_USES = 12;
export const MEDIA_USER_REQUESTS_PER_MINUTE = 20;

type MediaVideoRow = {
  id: string;
  source: VideoSource;
  source_video_id: string;
  duration_seconds: number;
};

export const mediaRouter = new Hono<ApiBindings>();

export function assertMediaSourceAllowed(
  source: unknown,
): asserts source is VideoSource {
  SourceSchema.parse(source);
}

export async function enforceMediaRequestBudget(
  db: D1Database,
  userId: string,
  token: string,
): Promise<void> {
  await enforceRateLimit(db, {
    namespace: "media-stream-user",
    identifier: userId,
    maximum: MEDIA_USER_REQUESTS_PER_MINUTE,
    windowSeconds: 60,
  });
  await enforceRateLimit(db, {
    namespace: "media-stream-token",
    identifier: token,
    maximum: MEDIA_TOKEN_MAX_USES,
    windowSeconds: MEDIA_TTL_SECONDS,
  });
}

mediaRouter.post("/resolve", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "media-resolve",
    identifier: user.id,
    maximum: 10,
    windowSeconds: 60,
  });
  const input = await parseJson(c, MediaResolveRequestSchema);
  const video = await c.env.DB.prepare(
    "SELECT id, source, source_video_id, duration_seconds FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(input.videoId, user.id)
    .first<MediaVideoRow>();
  if (!video || !SourceSchema.safeParse(video.source).success) {
    throw new ApiError(404, "video_not_found", "Video not found.");
  }
  assertMediaSourceAllowed(video.source);
  if (video.duration_seconds > MAX_CAPTIONLESS_DURATION_SECONDS) {
    throw new ApiError(
      422,
      "captionless_video_too_long",
      "Captionless videos are limited to 90 minutes for trustworthy on-device transcription.",
    );
  }

  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = Date.now() + MEDIA_TTL_SECONDS * 1_000;
  const tokenData: MediaToken = {
    userId: user.id,
    videoId: video.id,
    expiresAt,
  };
  await c.env.CACHE.put(`media:${token}`, JSON.stringify(tokenData), {
    expirationTtl: MEDIA_TTL_SECONDS,
  });
  return c.json(
    MediaResolveResponseSchema.parse({
      mediaUrl: `${c.env.APP_ORIGIN}/api/media/${token}`,
      expiresAt: new Date(expiresAt).toISOString(),
      maximumDurationSeconds: MAX_CAPTIONLESS_DURATION_SECONDS,
    }),
  );
});

mediaRouter.get("/:token", async (c) => {
  const user = c.get("user");
  const tokenId = c.req.param("token");
  const raw = await c.env.CACHE.get(`media:${tokenId}`);
  if (!raw)
    throw new ApiError(
      404,
      "media_token_expired",
      "This media link expired. Request a new one.",
    );

  let token: MediaToken;
  try {
    token = JSON.parse(raw) as MediaToken;
  } catch {
    throw new ApiError(
      404,
      "media_token_expired",
      "This media link is invalid.",
    );
  }
  if (token.userId !== user.id || token.expiresAt < Date.now()) {
    throw new ApiError(
      403,
      "media_token_forbidden",
      "This media link belongs to another session or expired.",
    );
  }
  await enforceMediaRequestBudget(c.env.DB, user.id, tokenId);
  const video = await c.env.DB.prepare(
    "SELECT id, source, source_video_id, duration_seconds FROM videos WHERE id = ? AND owner_id = ?",
  )
    .bind(token.videoId, user.id)
    .first<MediaVideoRow>();
  if (!video) throw new ApiError(404, "video_not_found", "Video not found.");
  const source = SourceSchema.parse(video.source);
  assertMediaSourceAllowed(source);
  const stream = await getSourceAdapter(source).streamAudio(
    video.source_video_id,
    c.req.raw,
  );
  const headers = new Headers({
    "Content-Type": stream.contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (stream.contentLength) headers.set("Content-Length", stream.contentLength);
  if (stream.acceptRanges) headers.set("Accept-Ranges", stream.acceptRanges);
  if (stream.contentRange) headers.set("Content-Range", stream.contentRange);
  return new Response(stream.body, {
    status: c.req.header("range") ? 206 : 200,
    headers,
  });
});
