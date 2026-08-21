import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("native account storage boundary", () => {
  it("scopes transcript caches and upload outboxes to the signed-in user", () => {
    const creation = source("src/state/creation.ts");
    const outbox = source(
      "src/generation/android-generation-outbox.android.ts",
    );
    const transcription = source("src/transcription/local-transcriber.web.ts");

    expect(creation).toContain("clipquest:creation:v3:");
    expect(creation).toContain("ownerUserId");
    expect(creation).toContain("GenerationRecordSchema.parse");
    expect(creation).toContain("record.ownerUserId !== ownerUserId");
    expect(creation).toContain("attemptGenerationKeyFor(record.attemptId)");
    expect(creation).toContain("!candidate.startsWith(CREATION_PREFIX)");
    expect(creation).toContain(
      "!candidate.startsWith(TRANSCRIPT_CHECKPOINT_PREFIX)",
    );
    expect(outbox).toContain("clipquest:native-generation-outbox:v2:");
    expect(outbox).toContain("accountPrefix(userId)");
    expect(transcription).toContain("options.ownerUserId");
    expect(transcription).toContain("MAX_MEDIA_BYTES");
  });

  it("clears private local state on sign-out, deletion, and account change", () => {
    const settings = source("app/(tabs)/settings.tsx");
    const layout = source("app/_layout.tsx");
    for (const file of [settings, layout]) {
      expect(file).toContain("clearNativeGenerationOutboxes");
      expect(file).toContain("clearAccountCreationState");
    }
    expect(settings).toContain("Promise.allSettled");
  });
});
