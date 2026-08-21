import { describe, expect, it } from "vitest";
import { androidAssetLinks } from "../src/lib/android-app-links";

describe("Android App Links association", () => {
  it("publishes only a complete release certificate fingerprint", () => {
    const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
    expect(androidAssetLinks(fingerprint)?.[0]?.target).toEqual({
      namespace: "android_app",
      package_name: "cc.ccwu.clipquest",
      sha256_cert_fingerprints: [fingerprint],
    });
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks("debug-certificate")).toBeNull();
  });
});
