import type { AppEnv } from "../types";

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

export async function cacheThumbnail(env: AppEnv, videoId: string, remoteUrl: string): Promise<void> {
  try {
    const response = await fetch(remoteUrl, { redirect: "follow" });
    if (!response.ok || !response.body) return;
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_THUMBNAIL_BYTES) return;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) return;
    const key = `thumbnails/${videoId}`;
    await env.PRIVATE_BUCKET.put(key, bytes, {
      httpMetadata: {
        contentType: response.headers.get("content-type") ?? "image/jpeg",
        cacheControl: "public, max-age=86400",
      },
    });
    await env.DB.prepare("UPDATE videos SET thumbnail_key = ?, updated_at = ? WHERE id = ?")
      .bind(key, Date.now(), videoId)
      .run();
  } catch (error) {
    console.warn("Thumbnail caching failed", error);
  }
}

