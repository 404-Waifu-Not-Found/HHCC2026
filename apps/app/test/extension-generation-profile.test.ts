import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MINIMUM_LEGACY_LOCAL_AI_EXTENSION_VERSION,
  MINIMUM_LOCAL_AI_EXTENSION_VERSION,
  isCompatibleClipQuestExtensionVersion,
  supportsQuestionStream,
} from "../src/transcription/extension-compat";

describe("extension generation profile compatibility", () => {
  it("keeps the disabled rollout compatible with v0.8.0 and stream v1", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.0",
        MINIMUM_LEGACY_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v1"], "legacy_reasoning_v5_1"),
    ).toBe(true);
  });

  it("keeps v0.8.2 and stream v2 available only for the v5.2 compatibility profile", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.1",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v1"],
        "stable_non_thinking_v5_2",
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v1", "question-stream-v2"],
        "stable_non_thinking_v5_2",
      ),
    ).toBe(true);
  });

  it("requires v0.8.3 and stream v3 for automatic recovery", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.2",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v2"],
        "stable_auto_recovery_v5_3",
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v2", "question-stream-v3"],
        "stable_auto_recovery_v5_3",
      ),
    ).toBe(true);
  });

  it("requires v0.8.7 and stream v5 for concept-only grounded recovery", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.3",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.5",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.6",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.7",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(true);
    expect(supportsQuestionStream(["question-stream-v4"])).toBe(false);
    expect(
      supportsQuestionStream(["question-stream-v4", "question-stream-v5"]),
    ).toBe(true);
  });

  it("contains no learner-facing manual generation continuation control", () => {
    const files = [
      "../src/components/QuestionStreamIndicator.tsx",
      "../app/quiz/[attemptId].tsx",
      "../app/generation/[videoId].tsx",
    ].map((relativePath) =>
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), relativePath),
        "utf8",
      ),
    );
    for (const source of files) {
      expect(source).not.toMatch(/Continue generating/i);
      expect(source).not.toMatch(/onContinue/);
      expect(source).not.toMatch(/continuingGeneration/);
    }
  });

  it("reacquires safe video metadata when the local import cache is gone", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/generation/progressive-continuation.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      "/api/videos/${encodeURIComponent(continuation.videoId)}/recovery",
    );
    expect(source).toContain("saveImportedVideo(imported)");
  });
});
