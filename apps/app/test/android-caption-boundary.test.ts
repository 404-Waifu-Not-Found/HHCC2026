import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

describe("cross-platform caption-only generation boundary", () => {
  it("fails clearly before AI generation when captions are unavailable", () => {
    const creation = readFileSync(
      resolve(appRoot, "app/generation/[videoId].tsx"),
      "utf8",
    );
    const recovery = readFileSync(
      resolve(appRoot, "src/generation/progressive-continuation.ts"),
      "utf8",
    );
    const message =
      "Verified YouTube captions are required. ClipQuest does not download or transcribe video audio.";
    for (const source of [creation, recovery]) {
      expect(source).toContain("CAPTIONS_REQUIRED_MESSAGE");
      expect(source).not.toContain('"/api/media/resolve"');
      expect(source).not.toContain("transcribeLocally");
    }
    const captions = readFileSync(
      resolve(appRoot, "src/transcription/acquire-text-transcript.ts"),
      "utf8",
    );
    expect(captions).toContain(message);
  });

  it("does not ship a speech model or audio-decoder dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(appRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      expo?: unknown;
    };
    expect(packageJson.dependencies).not.toHaveProperty("whisper.rn");
    expect(packageJson.dependencies).not.toHaveProperty(
      "@clipquest/local-audio-decoder",
    );
    expect(packageJson.dependencies).not.toHaveProperty(
      "@huggingface/transformers",
    );
    expect(packageJson.dependencies).not.toHaveProperty("mp4box");
    expect(packageJson.expo).toBeUndefined();
  });

  it("removes server media and model delivery surfaces", () => {
    const apiRoot = resolve(appRoot, "../api");
    const apiIndex = readFileSync(resolve(apiRoot, "src/index.ts"), "utf8");
    const workerConfig = readFileSync(
      resolve(apiRoot, "wrangler.jsonc"),
      "utf8",
    );
    expect(apiIndex).not.toContain('app.route("/api/media"');
    expect(apiIndex).not.toContain('app.route("/api/models"');
    expect(workerConfig).not.toContain("MODEL_MANIFEST_KEY");
    expect(existsSync(resolve(apiRoot, "src/routes/media.ts"))).toBe(false);
    expect(existsSync(resolve(apiRoot, "src/routes/models.ts"))).toBe(false);
    expect(existsSync(resolve(appRoot, "public/whisper-worker.js"))).toBe(
      false,
    );
  });
});
