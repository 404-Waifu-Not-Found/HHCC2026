import type { AppEnv } from "../types";
import { safeErrorName } from "./safe-error";

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_FETCH_TIMEOUT_MS = 5_000;
export const THUMBNAIL_RETRY_AFTER_SECONDS = 1;

const ALLOWED_THUMBNAIL_HOSTS = new Set(["i.ytimg.com", "img.youtube.com"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ThumbnailFailureReason =
  | "invalid_url"
  | "upstream_status"
  | "missing_body"
  | "unsupported_content_type"
  | "too_large"
  | "invalid_image"
  | "timeout"
  | "network_error";

export type ThumbnailFetchResult =
  | {
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      contentType: string;
      elapsedMs: number;
    }
  | {
      ok: false;
      reason: ThumbnailFailureReason;
      elapsedMs: number;
      upstreamStatus?: number;
    };

export type ThumbnailCacheResult =
  | (Extract<ThumbnailFetchResult, { ok: true }> & {
      cacheKey: string;
      etag?: string;
      persisted: boolean;
    })
  | Extract<ThumbnailFetchResult, { ok: false }>;

type ThumbnailFetcher = (input: string, init: RequestInit) => Promise<Response>;

type FetchThumbnailOptions = {
  fetcher?: ThumbnailFetcher;
  timeoutMs?: number;
};

export function thumbnailCacheKey(videoId: string): string {
  return `thumbnails/${videoId}`;
}

export function isAllowedThumbnailUrl(
  remoteUrl: string,
  sourceVideoId: string,
): boolean {
  try {
    const url = new URL(remoteUrl);
    if (
      url.protocol !== "https:" ||
      !ALLOWED_THUMBNAIL_HOSTS.has(url.hostname)
    ) {
      return false;
    }
    const path = url.pathname.split("/").filter(Boolean);
    const thumbnailDirectory = path.findIndex(
      (segment) => segment === "vi" || segment === "vi_webp",
    );
    return (
      thumbnailDirectory >= 0 &&
      path[thumbnailDirectory + 1] === sourceVideoId &&
      Boolean(path[thumbnailDirectory + 2])
    );
  } catch {
    return false;
  }
}

export async function fetchThumbnailBytes(
  remoteUrl: string,
  sourceVideoId: string,
  options: FetchThumbnailOptions = {},
): Promise<ThumbnailFetchResult> {
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  if (!isAllowedThumbnailUrl(remoteUrl, sourceVideoId)) {
    return { ok: false, reason: "invalid_url", elapsedMs: elapsedMs() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? THUMBNAIL_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetcher ?? fetch)(remoteUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "image/webp,image/png,image/jpeg" },
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: "upstream_status",
        elapsedMs: elapsedMs(),
        upstreamStatus: response.status,
      };
    }
    if (response.url && !isAllowedThumbnailUrl(response.url, sourceVideoId)) {
      return { ok: false, reason: "invalid_url", elapsedMs: elapsedMs() };
    }
    if (!response.body) {
      return { ok: false, reason: "missing_body", elapsedMs: elapsedMs() };
    }

    const contentType = normalizedContentType(
      response.headers.get("content-type"),
    );
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      await response.body.cancel();
      return {
        ok: false,
        reason: "unsupported_content_type",
        elapsedMs: elapsedMs(),
      };
    }

    const declaredLength = parsedContentLength(
      response.headers.get("content-length"),
    );
    if (declaredLength !== undefined && declaredLength > MAX_THUMBNAIL_BYTES) {
      await response.body.cancel();
      return { ok: false, reason: "too_large", elapsedMs: elapsedMs() };
    }

    const bytes = await readBoundedBody(response.body, MAX_THUMBNAIL_BYTES);
    if (!bytes) {
      return { ok: false, reason: "too_large", elapsedMs: elapsedMs() };
    }
    if (!hasExpectedSignature(bytes, contentType)) {
      return {
        ok: false,
        reason: "invalid_image",
        elapsedMs: elapsedMs(),
      };
    }
    return { ok: true, bytes, contentType, elapsedMs: elapsedMs() };
  } catch (error) {
    return {
      ok: false,
      reason:
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
          ? "timeout"
          : "network_error",
      elapsedMs: elapsedMs(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function cacheThumbnail(
  env: AppEnv,
  input: {
    videoId: string;
    sourceVideoId: string;
    remoteUrl: string;
  },
  options: FetchThumbnailOptions = {},
): Promise<ThumbnailCacheResult> {
  const result = await fetchThumbnailBytes(
    input.remoteUrl,
    input.sourceVideoId,
    options,
  );
  if (!result.ok) {
    logThumbnail("fetch_failed", input, result);
    return result;
  }

  const cacheKey = thumbnailCacheKey(input.videoId);
  let etag: string | undefined;
  try {
    const object = await env.PRIVATE_BUCKET.put(cacheKey, result.bytes, {
      httpMetadata: {
        contentType: result.contentType,
        cacheControl: "public, max-age=86400",
      },
    });
    etag = object.httpEtag;
    await env.DB.prepare(
      "UPDATE videos SET thumbnail_key = ?, updated_at = ? WHERE id = ?",
    )
      .bind(cacheKey, Date.now(), input.videoId)
      .run();
    const cached = { ...result, cacheKey, etag, persisted: true } as const;
    logThumbnail("cache_filled", input, cached);
    return cached;
  } catch (error) {
    const uncached = { ...result, cacheKey, etag, persisted: false } as const;
    console.error(
      JSON.stringify({
        scope: "thumbnail",
        event: "persistence_failed",
        videoId: input.videoId,
        sourceVideoId: input.sourceVideoId,
        bytes: result.bytes.byteLength,
        elapsedMs: result.elapsedMs,
        errorName: safeErrorName(error),
      }),
    );
    return uncached;
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("Thumbnail exceeded the maximum size.");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function normalizedContentType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function parsedContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function hasExpectedSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function logThumbnail(
  event: "cache_filled" | "fetch_failed",
  input: { videoId: string; sourceVideoId: string },
  result: ThumbnailCacheResult,
): void {
  console.info(
    JSON.stringify({
      scope: "thumbnail",
      event,
      videoId: input.videoId,
      sourceVideoId: input.sourceVideoId,
      ok: result.ok,
      ...(result.ok
        ? {
            bytes: result.bytes.byteLength,
            contentType: result.contentType,
            persisted: result.persisted,
          }
        : {
            reason: result.reason,
            upstreamStatus: result.upstreamStatus,
          }),
      elapsedMs: result.elapsedMs,
    }),
  );
}
