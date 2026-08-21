import { describe, expect, it } from "vitest";
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

  it("requires v0.8.2 and stream v2 for the stable profile", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.1",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(supportsQuestionStream(["question-stream-v1"])).toBe(false);
    expect(
      supportsQuestionStream(["question-stream-v1", "question-stream-v2"]),
    ).toBe(true);
  });
});
