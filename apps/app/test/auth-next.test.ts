import { describe, expect, it } from "vitest";
import { parseNextPath, withNextParam } from "../src/lib/auth-next";

describe("auth next path", () => {
  it("accepts only shared-quest preview paths", () => {
    expect(
      parseNextPath({ next: "/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a" }),
    ).toBe("/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a");
    expect(parseNextPath({ next: ["/s/abc-123", "/s/other"] })).toBe(
      "/s/abc-123",
    );
    expect(parseNextPath({ next: " /s/abc " })).toBe("/s/abc");
  });

  it("drops anything that could redirect elsewhere", () => {
    expect(parseNextPath({})).toBeNull();
    expect(parseNextPath({ next: "https://evil.example/s/abc" })).toBeNull();
    expect(parseNextPath({ next: "//evil.example/s/abc" })).toBeNull();
    expect(parseNextPath({ next: "/s/../library" })).toBeNull();
    expect(parseNextPath({ next: "/library" })).toBeNull();
    expect(parseNextPath({ next: "/s/" })).toBeNull();
    expect(parseNextPath({ next: "/s/abc?x=1" })).toBeNull();
    expect(parseNextPath({ next: "/s/abc/extra" })).toBeNull();
  });

  it("merges next into route params only when present", () => {
    expect(withNextParam(null, null)).toBeNull();
    expect(
      withNextParam({ url: "https://youtu.be/x", autostart: "1" }, null),
    ).toEqual({
      url: "https://youtu.be/x",
      autostart: "1",
    });
    expect(withNextParam(null, "/s/abc")).toEqual({ next: "/s/abc" });
    expect(
      withNextParam({ url: "https://youtu.be/x", autostart: "1" }, "/s/abc"),
    ).toEqual({ url: "https://youtu.be/x", autostart: "1", next: "/s/abc" });
  });
});
