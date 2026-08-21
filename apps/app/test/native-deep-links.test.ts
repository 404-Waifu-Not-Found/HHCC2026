import { describe, expect, it } from "vitest";
import { nativeRouteForUrl } from "../src/navigation/native-deep-links";

describe("native deep links", () => {
  it("normalizes host-style and path-style custom links", () => {
    expect(nativeRouteForUrl("clipquest://sign-in")).toBe("/(auth)/sign-in");
    expect(nativeRouteForUrl("clipquest:///sign-in")).toBe("/(auth)/sign-in");
    expect(nativeRouteForUrl("clipquest://reset-password?token=a%20b")).toBe(
      "/(auth)/reset-password?token=a+b",
    );
  });

  it("accepts only ClipQuest web links and supported routes", () => {
    expect(nativeRouteForUrl("https://clipquest.ccwu.cc/library")).toBe(
      "/(tabs)/library",
    );
    expect(nativeRouteForUrl("https://example.com/sign-in")).toBeNull();
    expect(nativeRouteForUrl("clipquest://unknown")).toBeNull();
    expect(nativeRouteForUrl("not a url")).toBeNull();
  });
});
