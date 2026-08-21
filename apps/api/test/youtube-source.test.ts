import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadYouTubeCaptionSegments,
  parseYouTubeTimedText,
  selectPreferredYouTubeCaptionTrack,
} from "../src/sources/youtube";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("YouTube timed text", () => {
  it("turns json3 events into normalized transcript segments", () => {
    expect(
      parseYouTubeTimedText({
        events: [
          { tStartMs: 100, dDurationMs: 450, segs: [{ utf8: "Hello" }, { utf8: "   world" }] },
          { tStartMs: "700", segs: [{ utf8: "Next\nline" }] },
          { tStartMs: 900, segs: [{ acAsrConf: 0 }] },
        ],
      }),
    ).toEqual([
      { id: "yt-1", startMs: 100, endMs: 550, text: "Hello world" },
      { id: "yt-2", startMs: 700, endMs: 1_700, text: "Next line" },
    ]);
  });

  it("prefers manual English, then Chinese, before unrelated or generated tracks", () => {
    const tracks = [
      { base_url: "https://www.youtube.com/api/timedtext", language_code: "fr" },
      { base_url: "https://www.youtube.com/api/timedtext", language_code: "en", kind: "asr" as const },
      { base_url: "https://www.youtube.com/api/timedtext", language_code: "zh-Hans" },
      { base_url: "https://www.youtube.com/api/timedtext", language_code: "en-GB" },
    ];
    expect(selectPreferredYouTubeCaptionTrack(tracks)).toBe(tracks[3]);
  });

  it("loads json3 only from an HTTPS YouTube host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: "Caption" }] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadYouTubeCaptionSegments({
        base_url: "https://www.youtube.com/api/timedtext?v=video-id",
        language_code: "en",
      }),
    ).resolves.toEqual([{ id: "yt-1", startMs: 0, endMs: 500, text: "Caption" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "www.youtube.com" }),
      expect.objectContaining({ redirect: "error" }),
    );

    await expect(
      loadYouTubeCaptionSegments({
        base_url: "https://youtube.com.attacker.example/api/timedtext",
        language_code: "en",
      }),
    ).rejects.toThrow("YouTube captions could not be loaded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
