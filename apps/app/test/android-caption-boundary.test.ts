import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

describe("native caption-only generation boundary", () => {
  it("fails before media resolution when captions are unavailable", () => {
    const creation = readFileSync(
      resolve(appRoot, "app/generation/[videoId].tsx"),
      "utf8",
    );
    const recovery = readFileSync(
      resolve(appRoot, "src/generation/progressive-continuation.ts"),
      "utf8",
    );
    const message =
      "This native beta requires a public YouTube video with usable captions.";
    for (const source of [creation, recovery]) {
      const nativeGuard = source.indexOf('Platform.OS !== "web"');
      const captionFailure = source.indexOf(message, nativeGuard);
      const mediaResolve = source.indexOf(
        '"/api/media/resolve"',
        captionFailure,
      );
      expect(nativeGuard).toBeGreaterThanOrEqual(0);
      expect(captionFailure).toBeGreaterThan(nativeGuard);
      expect(mediaResolve).toBeGreaterThan(captionFailure);
    }
  });

  it("excludes Whisper and the audio decoder from Android autolinking", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(appRoot, "package.json"), "utf8"),
    ) as {
      expo?: { autolinking?: { android?: { exclude?: string[] } } };
    };
    expect(packageJson.expo?.autolinking?.android?.exclude).toEqual(
      expect.arrayContaining(["whisper.rn", "@clipquest/local-audio-decoder"]),
    );
  });
});
