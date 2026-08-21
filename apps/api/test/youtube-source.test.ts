import { describe, expect, it } from "vitest";
import {
  extractYouTubePlayerResponse,
  isRetryableYouTubeAudioStatus,
  parseYouTubePlayerResponse,
  parseYouTubeTimedText,
  selectYouTubeAudioFormatRequests,
  selectPreferredYouTubeCaptionTrack,
} from "../src/sources/youtube";

describe("YouTube metadata", () => {
  it("only retries transient signed-audio failures", () => {
    expect(isRetryableYouTubeAudioStatus(401)).toBe(true);
    expect(isRetryableYouTubeAudioStatus(403)).toBe(true);
    expect(isRetryableYouTubeAudioStatus(429)).toBe(true);
    expect(isRetryableYouTubeAudioStatus(503)).toBe(true);
    expect(isRetryableYouTubeAudioStatus(404)).toBe(false);
    expect(isRetryableYouTubeAudioStatus(416)).toBe(false);
  });

  it("uses a progressive Android source for full downloads and compact iOS audio for ranges", () => {
    expect(selectYouTubeAudioFormatRequests(false)).toEqual([
      { client: "ANDROID", type: "video+audio" },
      { client: "IOS", type: "audio" },
    ]);
    expect(selectYouTubeAudioFormatRequests(true)).toEqual([
      { client: "IOS", type: "audio" },
      { client: "ANDROID", type: "video+audio" },
    ]);
  });

  it("extracts bounded player metadata without being confused by braces inside strings", () => {
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: {
        title: "Neural {networks}",
        lengthSeconds: "1120",
        thumbnail: {
          thumbnails: [{ url: "https://i.ytimg.com/example.jpg", width: 480 }],
        },
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?signed=yes",
              languageCode: "en",
              name: { runs: [{ text: "English" }] },
            },
          ],
        },
      },
    })};</script>`;

    expect(
      parseYouTubePlayerResponse(extractYouTubePlayerResponse(html)),
    ).toEqual({
      title: "Neural {networks}",
      durationSeconds: 1120,
      thumbnails: [{ url: "https://i.ytimg.com/example.jpg", width: 480 }],
      tracks: [
        {
          base_url: "https://www.youtube.com/api/timedtext?signed=yes",
          language_code: "en",
          label: "English",
        },
      ],
    });
  });

  it("prefers manual English, then Chinese, before unrelated or generated tracks", () => {
    const tracks = [
      {
        base_url: "https://www.youtube.com/api/timedtext",
        language_code: "fr",
      },
      {
        base_url: "https://www.youtube.com/api/timedtext",
        language_code: "en",
        kind: "asr" as const,
      },
      {
        base_url: "https://www.youtube.com/api/timedtext",
        language_code: "zh-Hans",
      },
      {
        base_url: "https://www.youtube.com/api/timedtext",
        language_code: "en-GB",
      },
    ];
    expect(selectPreferredYouTubeCaptionTrack(tracks)).toBe(tracks[3]);
  });

  it("normalizes fresh YouTube timed-text while removing empty events", () => {
    expect(
      parseYouTubeTimedText({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 1500,
            segs: [{ utf8: "Primitive " }, { utf8: "types" }],
          },
          {
            tStartMs: 1500,
            dDurationMs: 2000,
            segs: [{ utf8: "\nstore simple values in Java." }],
          },
          { tStartMs: 3500, segs: [{ utf8: "   " }] },
        ],
      }),
    ).toEqual([
      { id: "youtube-0-0", startMs: 0, endMs: 1500, text: "Primitive types" },
      {
        id: "youtube-1-1500",
        startMs: 1500,
        endMs: 3500,
        text: "store simple values in Java.",
      },
    ]);
  });

  it("does not silently cut subtitles at 12,000 events", () => {
    const eventCount = 12_005;
    const segments = parseYouTubeTimedText({
      events: Array.from({ length: eventCount }, (_, index) => ({
        tStartMs: index * 1_000,
        dDurationMs: 1_000,
        segs: [{ utf8: `complete subtitle ${index + 1}` }],
      })),
    });

    expect(segments).toHaveLength(eventCount);
    expect(segments.at(-1)?.text).toBe(`complete subtitle ${eventCount}`);
  });
});
