import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFreshYouTubeCaptions,
  validateCaptionSegments,
} from "../src/sources/youtube-captions";
import type { AppEnv } from "../src/types";

function createEnv(): AppEnv {
  return {
    BRIGHT_DATA_API_KEY: "test-bright-key",
    SUPADATA_API_KEY: "test-supadata-key",
    CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppEnv;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fresh YouTube captions", () => {
  it("calls the provider again for every import and never uses source storage", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify([
            {
              title: "Primitive Types",
              video_length: 30,
              transcription_language: "en",
              transcript:
                "Primitive types hold simple values and arithmetic expressions combine them.",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = createEnv();

    await expect(
      fetchFreshYouTubeCaptions(
        env,
        "https://www.youtube.com/watch?v=BjRvQbWsTfM",
        "request-1",
      ),
    ).resolves.toMatchObject({ provider: "bright_data", language: "en" });
    await expect(
      fetchFreshYouTubeCaptions(
        env,
        "https://www.youtube.com/watch?v=BjRvQbWsTfM",
        "request-2",
      ),
    ).resolves.toMatchObject({ provider: "bright_data", language: "en" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "Cache-Control": "no-cache, no-store",
      }),
    });
  });

  it("rejects unsorted, duplicate, empty, and malformed caption segments", () => {
    const valid = {
      id: "one",
      startMs: 1_000,
      endMs: 2_000,
      text: "A sufficiently long caption segment.",
    };
    expect(() =>
      validateCaptionSegments([
        valid,
        { ...valid, id: "two", startMs: 500, endMs: 900 },
      ]),
    ).toThrow("ordering");
    expect(() => validateCaptionSegments([valid, valid])).toThrow("ordering");
    expect(() => validateCaptionSegments([])).toThrow("no usable text");
    expect(() => validateCaptionSegments([{ ...valid, endMs: 500 }])).toThrow();
  });
});
