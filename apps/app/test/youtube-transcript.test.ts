import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBrowserYouTubeTranscript,
  parseBrowserYouTubeTranscript,
} from "../src/transcription/youtube-transcript";

afterEach(() => {
  vi.unstubAllGlobals();
});

const markdown = `# Transcript: AP Biology Photosynthesis

Source video: https://www.youtube.com/watch?v=Le7KOX91w7U
Language: English · Duration: 3:41 · Words: 574

## Transcript
[0:00] Light energy drives the light-dependent reactions.

[0:30] Water is split to replace chlorophyll's electrons.

[1:04] A proton gradient powers ATP synthase.`;

describe("browser YouTube transcript fallback", () => {
  it("accepts only the requested public YouTube transcript", () => {
    expect(parseBrowserYouTubeTranscript("Le7KOX91w7U", markdown)).toEqual([
      {
        id: "yt-browser-1",
        startMs: 0,
        endMs: 30_000,
        text: "Light energy drives the light-dependent reactions.",
      },
      {
        id: "yt-browser-2",
        startMs: 30_000,
        endMs: 64_000,
        text: "Water is split to replace chlorophyll's electrons.",
      },
      {
        id: "yt-browser-3",
        startMs: 64_000,
        endMs: 221_000,
        text: "A proton gradient powers ATP synthase.",
      },
    ]);
    expect(parseBrowserYouTubeTranscript("another-id", markdown)).toEqual([]);
  });

  it("fetches by video id and returns an empty list on a recoverable outage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(markdown, { status: 200 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(
      fetchBrowserYouTubeTranscript("Le7KOX91w7U", signal),
    ).resolves.toHaveLength(3);
    await expect(
      fetchBrowserYouTubeTranscript("Le7KOX91w7U", signal),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://youtube-transcript.ai/transcript/Le7KOX91w7U.txt?lang=en",
      ),
      expect.objectContaining({ signal }),
    );
  });
});
