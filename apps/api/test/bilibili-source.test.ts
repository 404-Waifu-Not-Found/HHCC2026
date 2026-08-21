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
      new BilibiliAdapter().inspect(new URL("https://www.bilibili.com/video/BV12rgX6HEcu/")),
    ).rejects.toMatchObject({
      code: "bilibili_unavailable",
      status: 502,
    });
  });
});
