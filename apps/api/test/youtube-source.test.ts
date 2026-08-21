import { describe, expect, it } from "vitest";
import {
  extractYouTubePlayerResponse,
  parseYouTubePlayerResponse,
  selectPreferredYouTubeCaptionTrack,
} from "../src/sources/youtube";

describe("YouTube metadata", () => {
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
});
