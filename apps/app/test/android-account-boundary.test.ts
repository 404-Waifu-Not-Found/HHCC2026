import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSerialTaskQueue } from "../src/lib/serial-task-queue";

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
    expect(creation).toContain("clipquest:preferences:v2:");
    expect(creation).toContain("preferencesKeyFor(ownerUserId, videoId)");
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
    const prework = source("src/generation/prework.ts");
    for (const file of [settings, layout]) {
      expect(file).toContain("clearNativeGenerationOutboxes");
      expect(file).toContain("clearAccountCreationState");
      expect(file).toContain("clearAccountAttemptState");
      expect(file).toContain("cancelPreGenerationForAccount");
    }
    expect(settings).toContain("Promise.allSettled");
    expect(settings).toMatch(
      /disableReviewReminders\(userId\)[\s\S]+removeLocalGenerationCredential\(userId\)[\s\S]+authClient\.signOut\(\)[\s\S]+result\.error[\s\S]+cancelPreGenerationForAccount/,
    );
    expect(settings).toMatch(
      /disableReviewReminders\(userId\)[\s\S]+removeLocalGenerationCredential\(userId\)[\s\S]+authClient\.deleteUser[\s\S]+result\.error[\s\S]+cancelPreGenerationForAccount/,
    );
    expect(settings).not.toMatch(
      /disableReviewReminders\(userId\)\.catch\(\(\) => undefined\)/,
    );
    expect(prework).toContain("initial.ownerUserId !== input.ownerUserId");
    expect(prework).toContain("current.ownerUserId !== input.ownerUserId");
    expect(prework).toContain("controller.signal.aborted");
    expect(prework).toContain("activeTask?.controller !== controller");
    expect(prework).toContain("clearImportedVideo");
  });

  it("serializes account-boundary effects before they update the marker", () => {
    const layout = source("app/_layout.tsx");

    expect(layout).toContain("createSerialTaskQueue()");
    expect(layout).toContain("nativeAccountBoundaryQueue.enqueue");
    expect(layout).toMatch(
      /const currentUserId = session\?\.user\.id \?\? null;[\s\S]+nativeAccountBoundaryQueue\.enqueue[\s\S]+removeLocalGenerationCredential\(previousUserId\)[\s\S]+AsyncStorage\.setItem\(OBSERVED_NATIVE_USER_KEY, currentUserId\)/,
    );
  });

  it("preserves every queued account transition in submission order", async () => {
    const queue = createSerialTaskQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push("account-a-start");
      await firstGate;
      order.push("account-a-finish");
    });
    const second = queue.enqueue(() => {
      order.push("account-b");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["account-a-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["account-a-start", "account-a-finish", "account-b"]);
  });
});
