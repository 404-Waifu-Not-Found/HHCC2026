import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireYouTubeSource,
  collapseAdjacentCaptionRepeats,
  parseBrowserTranscript,
  parseYouTubeJson3Transcript,
  parseYouTubeVideoId,
} from "../index.js";

test("parses supported YouTube URL shapes", () => {
  for (const value of [
    "JoscDcbAjbY",
    "https://www.youtube.com/watch?v=JoscDcbAjbY&t=20",
    "https://youtu.be/JoscDcbAjbY?si=test",
    "https://m.youtube.com/shorts/JoscDcbAjbY",
    "https://www.youtube.com/embed/JoscDcbAjbY",
  ]) {
    assert.equal(parseYouTubeVideoId(value), "JoscDcbAjbY");
  }
});

test("rejects lookalike YouTube hosts", () => {
  assert.throws(
    () =>
      parseYouTubeVideoId("https://youtube.com.example/watch?v=JoscDcbAjbY"),
    /recognized YouTube URL/,
  );
});

test("parses and verifies bounded transcript text", () => {
  const transcript = parseBrowserTranscript(
    [
      "# Transcript: Electricity",
      "",
      "Source video: https://www.youtube.com/watch?v=JoscDcbAjbY",
      "Language: English · Duration: 01:05 · Words: 20",
      "",
      "[0:01] Electric current is the movement of electric charge through a material.",
      "[0:10] Resistance opposes that movement and converts some energy to heat.",
    ].join("\n"),
    "JoscDcbAjbY",
  );
  assert.equal(transcript.language, "en");
  assert.equal(transcript.durationSeconds, 65);
  assert.equal(transcript.segments.length, 2);
});

test("collapses adjacent rolling-caption repeats", () => {
  assert.equal(
    collapseAdjacentCaptionRepeats("current moves current moves through wire"),
    "current moves through wire",
  );
});

test("parses local yt-dlp json3 captions without transcript fabrication", () => {
  const transcript = parseYouTubeJson3Transcript(
    JSON.stringify({
      events: [
        {
          tStartMs: 1_000,
          dDurationMs: 3_000,
          segs: [{ utf8: "Mass and energy " }, { utf8: "are related." }],
        },
        {
          tStartMs: 4_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "The speed of light is constant." }],
        },
      ],
    }),
    "en-US",
  );
  assert.equal(transcript.language, "en-US");
  assert.equal(transcript.sourceSegmentCount, 2);
  assert.equal(transcript.segments.length, 2);
  assert.match(transcript.segments[0].text, /Mass and energy are related/);
});

test("prefers an injected local caption reader for headless acquisition", async () => {
  let localCalls = 0;
  const source = await acquireYouTubeSource("JoscDcbAjbY", {
    adapters: {
      async fetch(url) {
        assert.match(String(url), /youtube\.com\/oembed/u);
        return new Response(JSON.stringify({ title: "Electricity" }));
      },
      async readLocalTranscript(videoId) {
        localCalls += 1;
        assert.equal(videoId, "JoscDcbAjbY");
        return parseYouTubeJson3Transcript(
          JSON.stringify({
            events: [
              {
                tStartMs: 0,
                dDurationMs: 4_000,
                segs: [
                  {
                    utf8: "Electric current is the movement of charge through a material.",
                  },
                ],
              },
            ],
          }),
        );
      },
    },
  });
  assert.equal(localCalls, 1);
  assert.equal(source.acquisition, "youtube_local_ytdlp");
});

test("acquisition validates metadata and transcript source together", async () => {
  const requests = [];
  const source = await acquireYouTubeSource("https://youtu.be/JoscDcbAjbY", {
    adapters: {
      async fetch(url) {
        requests.push(String(url));
        if (String(url).includes("oembed")) {
          return new Response(JSON.stringify({ title: "Electricity" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          [
            "Source video: https://www.youtube.com/watch?v=JoscDcbAjbY",
            "Language: en · Duration: 01:05",
            "[0:01] Electric current is the movement of electric charge through a material.",
            "[0:10] Resistance opposes that movement and converts some energy to heat.",
          ].join("\n"),
          { headers: { "Content-Type": "text/plain" } },
        );
      },
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(source.videoId, "JoscDcbAjbY");
  assert.equal(source.title, "Electricity");
  assert.match(source.transcriptFingerprint, /^[a-f0-9]{8}$/u);
});
