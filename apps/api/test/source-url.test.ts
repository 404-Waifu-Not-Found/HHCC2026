import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/errors";
import { normalizeSourceUrl, parseBilibiliId, parseYouTubeId } from "../src/sources/url";

afterEach(() => vi.restoreAllMocks());

describe("video source URL validation", () => {
  it("accepts only exact supported hosts", async () => {
    await expect(normalizeSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).resolves.toMatchObject({ source: "youtube" });
    await expect(normalizeSourceUrl("https://www.bilibili.com/video/BV1xx411c7mD")).resolves.toMatchObject({ source: "bilibili" });
    await expect(normalizeSourceUrl("https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ")).rejects.toMatchObject({
      code: "unsupported_video_url",
      status: 422,
    });
  });

  it("rejects non-web protocols", async () => {
    await expect(normalizeSourceUrl("file:///private/video.mp4")).rejects.toBeInstanceOf(ApiError);
  });

  it("resolves a b23 short link and validates the destination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://www.bilibili.com/video/BV1xx411c7mD" } }),
    );
    const result = await normalizeSourceUrl("https://b23.tv/demo");
    expect(result.source).toBe("bilibili");
    expect(result.url.hostname).toBe("www.bilibili.com");
  });

  it("caps recursive b23 redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://b23.tv/again" } }),
    );
    await expect(normalizeSourceUrl("https://b23.tv/demo")).rejects.toMatchObject({ code: "invalid_bilibili_link" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("source video IDs", () => {
  it("parses standard and short YouTube links", () => {
    expect(parseYouTubeId(new URL("https://youtube.com/watch?v=dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId(new URL("https://youtu.be/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId(new URL("https://youtube.com/shorts/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId(new URL("https://youtube.com/live/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId(new URL("https://youtube.com/embed/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
  });

  it("parses BV and av bilibili IDs", () => {
    expect(parseBilibiliId(new URL("https://bilibili.com/video/BV1xx411c7mD"))).toBe("BV1xx411c7mD");
    expect(parseBilibiliId(new URL("https://bilibili.com/video/av170001"))).toBe("av170001");
  });

  it("rejects malformed IDs", () => {
    expect(() => parseYouTubeId(new URL("https://youtube.com/watch?v=x"))).toThrow(ApiError);
    expect(() => parseBilibiliId(new URL("https://bilibili.com/read/cv1"))).toThrow(ApiError);
  });
});
