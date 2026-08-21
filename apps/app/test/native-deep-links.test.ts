import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRecentNativeEventGate,
  nativeRouteForUrl,
} from "../src/navigation/native-deep-links";

describe("native deep links", () => {
  it("normalizes host-style and path-style custom links", () => {
    expect(nativeRouteForUrl("clipquest://sign-in")).toBe("/(auth)/sign-in");
    expect(nativeRouteForUrl("clipquest:///sign-in")).toBe("/(auth)/sign-in");
    expect(
      nativeRouteForUrl("clipquest://reset-password?token=a%20b"),
    ).toBeNull();
    expect(
      nativeRouteForUrl("https://clipquest.ccwu.cc/reset-password?token=a%20b"),
    ).toBe("/(auth)/reset-password?token=a+b");
  });

  it("accepts only ClipQuest web links and supported routes", () => {
    expect(nativeRouteForUrl("https://clipquest.ccwu.cc/library")).toBe(
      "/(tabs)/library",
    );
    expect(nativeRouteForUrl("https://example.com/sign-in")).toBeNull();
    expect(nativeRouteForUrl("clipquest://unknown")).toBeNull();
    expect(nativeRouteForUrl("not a url")).toBeNull();
  });

  it("sends reset secrets only through application-bound HTTPS links", () => {
    const forgot = readFileSync(
      resolve(import.meta.dirname, "../app/(auth)/forgot-password.tsx"),
      "utf8",
    );
    const config = readFileSync(
      resolve(import.meta.dirname, "../app.config.ts"),
      "utf8",
    );
    expect(forgot).toContain(
      'redirectTo: "https://clipquest.ccwu.cc/reset-password"',
    );
    expect(forgot).not.toContain("clipquest://reset-password");
    expect(config).toContain('"applinks:clipquest.ccwu.cc"');
  });

  it("suppresses only immediate duplicate native deliveries", () => {
    const shouldHandle = createRecentNativeEventGate(1_500);
    expect(shouldHandle("https://clipquest.ccwu.cc/library", 10_000)).toBe(
      true,
    );
    expect(shouldHandle("https://clipquest.ccwu.cc/library", 10_100)).toBe(
      false,
    );
    expect(shouldHandle("https://clipquest.ccwu.cc/library", 11_600)).toBe(
      true,
    );
    expect(shouldHandle("https://clipquest.ccwu.cc/quiz/abc", 11_700)).toBe(
      true,
    );
  });

  it("clears a consumed notification response and handles async failures", () => {
    const layout = readFileSync(
      resolve(import.meta.dirname, "../app/_layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("clearLastNotificationResponseAsync");
    expect(layout).toContain("createRecentNativeEventGate");
    expect(layout).not.toContain("url === lastUrl");
    expect(
      layout.match(/\.catch\(\(\) => undefined\)/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });
});
