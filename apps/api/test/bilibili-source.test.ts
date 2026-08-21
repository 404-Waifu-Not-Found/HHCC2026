import { afterEach, describe, expect, it, vi } from "vitest";
import { BilibiliAdapter } from "../src/sources/bilibili";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bilibili source", () => {
  it("returns a source-specific outage when Bilibili serves an HTML challenge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>Request blocked</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await expect(
      new BilibiliAdapter().inspect(
        new URL("https://www.bilibili.com/video/BV12rgX6HEcu/"),
      ),
    ).rejects.toMatchObject({
      code: "bilibili_unavailable",
      status: 502,
    });
  });

  it("returns every subtitle entry with a matching completeness manifest", async () => {
    const subtitleCount = 12_005;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/x/web-interface/view")) {
          return Response.json({
            code: 0,
            data: {
              bvid: "BV12rgX6HEcu",
              aid: 1,
              title: "Complete calculus lesson",
              pic: "https://i.example/cover.jpg",
              duration: subtitleCount,
              cid: 2,
            },
          });
        }
        if (url.includes("/x/player/v2")) {
          return Response.json({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    lan: "en",
                    lan_doc: "English",
                    subtitle_url: "https://i.example/subtitles.json",
                    type: 0,
                  },
                ],
              },
            },
          });
        }
        return Response.json({
          body: Array.from({ length: subtitleCount }, (_, index) => ({
            from: index,
            to: index + 1,
            content: `full bilibili subtitle ${index + 1}`,
          })),
        });
      }),
    );

    const inspected = await new BilibiliAdapter().inspect(
      new URL("https://www.bilibili.com/video/BV12rgX6HEcu/"),
    );

    expect(inspected.preferredCaptionSegments).toHaveLength(subtitleCount);
    expect(inspected.preferredCaptionSegments?.at(-1)?.text).toBe(
      `full bilibili subtitle ${subtitleCount}`,
    );
    expect(inspected.preferredCaptionCompleteness).toMatchObject({
      status: "complete",
      truncated: false,
      sourceSegmentCount: subtitleCount,
      segmentCount: subtitleCount,
    });
  });
});
