import { describe, expect, it, vi } from "vitest";
import {
  fetchThumbnailBytes,
  isAllowedThumbnailUrl,
  MAX_THUMBNAIL_BYTES,
  thumbnailCacheKey,
} from "../src/lib/thumbnail";

const VIDEO_ID = "SVb9OV0bLzI";
const THUMBNAIL_URL = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe("YouTube thumbnail acquisition", () => {
  it("allows only HTTPS YouTube thumbnail URLs for the expected video", () => {
    expect(isAllowedThumbnailUrl(THUMBNAIL_URL, VIDEO_ID)).toBe(true);
    expect(
      isAllowedThumbnailUrl(
        `https://i.ytimg.com/vi_webp/${VIDEO_ID}/maxresdefault.webp`,
        VIDEO_ID,
      ),
    ).toBe(true);
    expect(
      isAllowedThumbnailUrl(
        `https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg`,
        VIDEO_ID,
      ),
    ).toBe(false);
    expect(
      isAllowedThumbnailUrl(
        `https://i.ytimg.com.attacker.example/vi/${VIDEO_ID}/hqdefault.jpg`,
        VIDEO_ID,
      ),
    ).toBe(false);
    expect(
      isAllowedThumbnailUrl(
        `http://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
        VIDEO_ID,
      ),
    ).toBe(false);
  });

  it("returns a bounded, signature-checked image", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JPEG_BYTES, {
          headers: {
            "Content-Length": String(JPEG_BYTES.byteLength),
            "Content-Type": "image/jpeg; charset=binary",
          },
        }),
    );

    const result = await fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
      fetcher,
    });

    expect(result).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(result.ok ? [...result.bytes] : []).toEqual([...JPEG_BYTES]);
    expect(fetcher).toHaveBeenCalledWith(
      THUMBNAIL_URL,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects upstream errors, oversized bodies, HTML, and invalid signatures", async () => {
    await expect(
      fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
        fetcher: async () => new Response(null, { status: 503 }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "upstream_status",
      upstreamStatus: 503,
    });

    await expect(
      fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
        fetcher: async () =>
          new Response(JPEG_BYTES, {
            headers: {
              "Content-Length": String(MAX_THUMBNAIL_BYTES + 1),
              "Content-Type": "image/jpeg",
            },
          }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "too_large" });

    await expect(
      fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
        fetcher: async () =>
          new Response("<html>rate limited</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "unsupported_content_type",
    });

    await expect(
      fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
        fetcher: async () =>
          new Response(new Uint8Array([0, 1, 2, 3]), {
            headers: { "Content-Type": "image/jpeg" },
          }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_image" });
  });

  it("times out a stalled upstream fetch", async () => {
    const fetcher = (_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });

    await expect(
      fetchThumbnailBytes(THUMBNAIL_URL, VIDEO_ID, {
        fetcher,
        timeoutMs: 1,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "timeout" });
  });

  it("uses a deterministic R2 key for cold-cache lookup", () => {
    expect(thumbnailCacheKey("video-123")).toBe("thumbnails/video-123");
  });
});
