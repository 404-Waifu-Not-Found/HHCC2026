import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("iOS native generation", () => {
  it("uses the shared local engine with account-scoped Keychain storage", () => {
    const client = source("src/generation/local-generation-client.ios.ts");
    const keyStore = source("src/generation/ios-local-ai.ios.ts");

    expect(client).toContain('kind: "ios_app"');
    expect(client).toContain("generateLocalQuiz(");
    expect(client).toContain("expoFetch");
    expect(client).toContain("disableStreaming: true");
    expect(client).toContain("flushLocalGenerationOutbox");
    expect(keyStore).toContain("expo-secure-store");
    expect(keyStore).toContain("WHEN_UNLOCKED_THIS_DEVICE_ONLY");
    expect(keyStore).toContain("accountKey(userId)");
  });

  it("treats captions, recovery, settings, and reminders as native features", () => {
    const generation = source("app/generation/[videoId].tsx");
    const creation = source("app/create/[videoId].tsx");
    const settings = source("app/(tabs)/settings.tsx");
    const reminders = source("src/notifications/review-reminders.native.ts");

    expect(generation).toContain('localClient.kind === "ios_app"');
    expect(generation).toContain(
      "rolloutProfile.clientRequirements.androidApp",
    );
    expect(generation).toContain('Platform.OS !== "web"');
    expect(generation).toContain("CAPTIONS_REQUIRED_MESSAGE");
    expect(generation).not.toContain('"/api/media/resolve"');
    expect(generation).not.toContain("transcribeLocally");
    expect(generation).toContain('"Question 1 unavailable"');
    expect(creation).toContain('Platform.OS !== "web" && generationId');
    expect(creation).toContain("captionsUnavailable || captionsFailed");
    expect(creation).not.toContain("nativeLocalFallback");
    expect(creation).toContain("openLocalGenerationClientSettings");
    expect(settings).toContain('Platform.OS !== "web"');
    expect(reminders).toContain('Platform.OS === "ios" ? "ios" : "android"');
  });

  it("does not expose ordinary text fields as secure entries", () => {
    const input = source("src/components/AppTextInput.tsx");
    expect(input).toContain("secureTextEntry={props.secureTextEntry === true}");
  });

  it("aborts the background local grading request when its UI timeout fires", () => {
    const quiz = source("app/quiz/[attemptId].tsx");
    expect(quiz).toContain("const gradingController = new AbortController();");
    expect(quiz).toContain("gradingController.signal");
    expect(quiz).toContain("gradingController.abort");
    expect(quiz).toContain("clearTimeout(gradingTimeout)");
  });
});
