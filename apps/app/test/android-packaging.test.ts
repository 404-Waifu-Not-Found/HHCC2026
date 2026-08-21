import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

describe("Android private-beta packaging", () => {
  it("pins the beta identity and supported SDK range", () => {
    const config = readFileSync(resolve(appRoot, "app.config.ts"), "utf8");
    expect(config).toContain('version: "0.2.0"');
    expect(config).toContain('package: "cc.ccwu.clipquest"');
    expect(config).toContain("versionCode: 2");

    expect(config).toContain('"expo-build-properties"');
    expect(config).toContain("minSdkVersion: 29");
    expect(config).toContain("targetSdkVersion: 36");
    expect(config).toContain("compileSdkVersion: 36");
  });

  it("removes legacy storage and overlay permissions from merged builds", () => {
    const config = readFileSync(resolve(appRoot, "app.config.ts"), "utf8");
    for (const permission of [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ]) {
      expect(config).toContain(`"${permission}"`);
    }
  });

  it("keeps Expo Updates disabled for the first private beta", () => {
    const config = readFileSync(resolve(appRoot, "app.config.ts"), "utf8");
    expect(config).toContain("updates: { enabled: false }");
  });

  it("forces EAS to regenerate native projects without uploading secrets", () => {
    const easIgnore = readFileSync(resolve(appRoot, ".easignore"), "utf8");
    expect(easIgnore).toMatch(/^\/android$/m);
    expect(easIgnore).toMatch(/^\/ios$/m);
    expect(easIgnore).toMatch(/^\.env\.\*$/m);
    expect(easIgnore).toMatch(/^\*\.keystore$/m);
  });
});
