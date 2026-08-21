import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/errors";
import { normalizeSourceUrl, parseYouTubeId } from "../src/sources/url";

describe("video source URL validation", () => {
  it("accepts only exact supported hosts", async () => {
    await expect(
      normalizeSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).resolves.toMatchObject({ source: "youtube" });
    await expect(
      normalizeSourceUrl("https://vimeo.com/123456789"),
    ).rejects.toMatchObject({
      code: "unsupported_video_url",
      status: 422,
    });
    await expect(
      normalizeSourceUrl(
        "https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ",
      ),
    ).rejects.toMatchObject({
      code: "unsupported_video_url",
      status: 422,
    });
  });

  it("rejects non-web protocols", async () => {
    await expect(
      normalizeSourceUrl("file:///private/video.mp4"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("source video IDs", () => {
  it("parses standard and short YouTube links", () => {
    expect(
      parseYouTubeId(new URL("https://youtube.com/watch?v=dQw4w9WgXcQ")),
    ).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId(new URL("https://youtu.be/dQw4w9WgXcQ"))).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      parseYouTubeId(new URL("https://youtube.com/shorts/dQw4w9WgXcQ")),
    ).toBe("dQw4w9WgXcQ");
    expect(
      parseYouTubeId(new URL("https://youtube.com/live/dQw4w9WgXcQ")),
    ).toBe("dQw4w9WgXcQ");
    expect(
      parseYouTubeId(new URL("https://youtube.com/embed/dQw4w9WgXcQ")),
    ).toBe("dQw4w9WgXcQ");
  });

  it("rejects malformed IDs", () => {
    expect(() =>
      parseYouTubeId(new URL("https://youtube.com/watch?v=x")),
    ).toThrow(ApiError);
  });
});
