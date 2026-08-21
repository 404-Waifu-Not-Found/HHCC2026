import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { removeDebugReleaseSigning } =
  require("../plugins/withAndroidReleaseSigningGuard.js") as {
    removeDebugReleaseSigning(contents: string): string;
  };

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

  it("never signs a generated release build with debug.keystore", () => {
    const generatedGradle = `
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
        }
    }`;

    const patched = removeDebugReleaseSigning(generatedGradle);
    expect(patched).toContain("signingConfig signingConfigs.debug");
    expect(patched.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(
      1,
    );
    expect(patched).toContain("release signing is injected by EAS Build");
    expect(removeDebugReleaseSigning(patched)).toBe(patched);

    const releaseBlock = patched.match(/release\s*\{[\s\S]*?\n\s{4}\}/)?.[0];
    expect(releaseBlock).toBeDefined();
    expect(releaseBlock).not.toContain("signingConfigs.debug");
  });
});
