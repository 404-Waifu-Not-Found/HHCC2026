import { describe, expect, it } from "vitest";
import {
  generationProfileAllowsNewBank,
  quizGenerationProfile,
  quizGenerationRolloutMode,
} from "../src/lib/generation-rollout";
import type { AppEnv } from "../src/types";

function env(
  mode?: string,
  canaryUserIds = "",
  automaticMode?: string,
  automaticCanaryUserIds = "",
  groundedMode?: string,
  groundedCanaryUserIds = "",
  promptFirstMode?: string,
  promptFirstCanaryUserIds = "",
  promptFirstV510Mode?: string,
  promptFirstV510CanaryUserIds = "",
  promptFirstV511Mode?: string,
  promptFirstV511CanaryUserIds = "",
  promptFirstV512Mode?: string,
  promptFirstV512CanaryUserIds = "",
): Pick<
  AppEnv,
  | "QUIZ_V5_2_ROLLOUT"
  | "QUIZ_V5_2_CANARY_USER_IDS"
  | "QUIZ_V5_3_ROLLOUT"
  | "QUIZ_V5_3_CANARY_USER_IDS"
  | "QUIZ_V5_4_ROLLOUT"
  | "QUIZ_V5_4_CANARY_USER_IDS"
  | "QUIZ_V5_9_ROLLOUT"
  | "QUIZ_V5_9_CANARY_USER_IDS"
  | "QUIZ_V5_10_ROLLOUT"
  | "QUIZ_V5_10_CANARY_USER_IDS"
  | "QUIZ_V5_11_ROLLOUT"
  | "QUIZ_V5_11_CANARY_USER_IDS"
  | "QUIZ_V5_12_ROLLOUT"
  | "QUIZ_V5_12_CANARY_USER_IDS"
> {
  return {
    QUIZ_V5_2_ROLLOUT: mode,
    QUIZ_V5_2_CANARY_USER_IDS: canaryUserIds,
    QUIZ_V5_3_ROLLOUT: automaticMode,
    QUIZ_V5_3_CANARY_USER_IDS: automaticCanaryUserIds,
    QUIZ_V5_4_ROLLOUT: groundedMode,
    QUIZ_V5_4_CANARY_USER_IDS: groundedCanaryUserIds,
    QUIZ_V5_9_ROLLOUT: promptFirstMode,
    QUIZ_V5_9_CANARY_USER_IDS: promptFirstCanaryUserIds,
    QUIZ_V5_10_ROLLOUT: promptFirstV510Mode,
    QUIZ_V5_10_CANARY_USER_IDS: promptFirstV510CanaryUserIds,
    QUIZ_V5_11_ROLLOUT: promptFirstV511Mode,
    QUIZ_V5_11_CANARY_USER_IDS: promptFirstV511CanaryUserIds,
    QUIZ_V5_12_ROLLOUT: promptFirstV512Mode,
    QUIZ_V5_12_CANARY_USER_IDS: promptFirstV512CanaryUserIds,
  };
}

describe("quiz generation rollout", () => {
  it("fails closed to the compatible v5.1 profile", () => {
    expect(quizGenerationRolloutMode(env())).toBe("disabled");
    expect(
      quizGenerationRolloutMode({ QUIZ_V5_12_ROLLOUT: "unexpected" }),
    ).toBe("disabled");
    expect(quizGenerationProfile(env(), "learner-1")).toEqual({
      generationProfile: "legacy_reasoning_v5_1",
      minimumExtensionVersion: "0.8.0",
      requiredCapability: "question-stream-v1",
    });
  });

  it("enables v5.2 only for exact canary IDs until global promotion", () => {
    const canary = env("canary", "learner-1, learner-2");
    expect(quizGenerationProfile(canary, "learner-1").generationProfile).toBe(
      "stable_non_thinking_v5_2",
    );
    expect(quizGenerationProfile(canary, "learner-10").generationProfile).toBe(
      "legacy_reasoning_v5_1",
    );
    expect(
      quizGenerationProfile(env("enabled"), "any-user").generationProfile,
    ).toBe("stable_non_thinking_v5_2");
  });

  it("enables v5.3 automatic recovery only for its exact rollout", () => {
    const canary = env("enabled", "", "canary", "learner-1");
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "stable_auto_recovery_v5_3",
      minimumExtensionVersion: "0.8.3",
      requiredCapability: "question-stream-v3",
    });
    expect(quizGenerationProfile(canary, "learner-2").generationProfile).toBe(
      "stable_non_thinking_v5_2",
    );
  });

  it("requires extension 0.8.13 for the concept-first rollout", () => {
    const canary = env("enabled", "", "enabled", "", "canary", "learner-1");
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "concept_first_auto_v5_8",
      minimumExtensionVersion: "0.8.13",
      requiredCapability: "question-stream-v6",
    });
    expect(quizGenerationProfile(canary, "learner-2").generationProfile).toBe(
      "stable_auto_recovery_v5_3",
    );
    expect(
      generationProfileAllowsNewBank(
        canary,
        "learner-1",
        "concept_first_auto_v5_8",
      ),
    ).toBe(true);
    expect(
      generationProfileAllowsNewBank(
        canary,
        "learner-1",
        "legacy_reasoning_v5_1",
      ),
    ).toBe(false);
    expect(
      generationProfileAllowsNewBank(
        canary,
        "learner-2",
        "legacy_reasoning_v5_1",
      ),
    ).toBe(false);
  });

  it("assigns prompt-first v5.9 only to its canary before promotion", () => {
    const canary = env(
      "disabled",
      "",
      "disabled",
      "",
      "enabled",
      "",
      "canary",
      "learner-1",
    );
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "prompt_first_auto_v5_9",
      minimumExtensionVersion: "0.8.14",
      requiredCapability: "question-stream-v7",
    });
    expect(quizGenerationProfile(canary, "learner-2")).toEqual({
      generationProfile: "concept_first_auto_v5_8",
      minimumExtensionVersion: "0.8.13",
      requiredCapability: "question-stream-v6",
    });
  });

  it("assigns prompt-first v5.10 ahead of the compatibility v5.9 rollout", () => {
    const canary = env(
      "disabled",
      "",
      "disabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "canary",
      "learner-1",
    );
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "prompt_first_auto_v5_10",
      minimumExtensionVersion: "0.8.15",
      requiredCapability: "question-stream-v7",
    });
    expect(quizGenerationProfile(canary, "learner-2")).toEqual({
      generationProfile: "prompt_first_auto_v5_9",
      minimumExtensionVersion: "0.8.14",
      requiredCapability: "question-stream-v7",
    });
  });

  it("assigns prompt-first v5.11 ahead of the compatibility v5.10 rollout", () => {
    const canary = env(
      "disabled",
      "",
      "disabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "canary",
      "learner-1",
    );
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "prompt_first_auto_v5_11",
      minimumExtensionVersion: "0.8.16",
      requiredCapability: "question-stream-v7",
    });
    expect(quizGenerationProfile(canary, "learner-2")).toEqual({
      generationProfile: "prompt_first_auto_v5_10",
      minimumExtensionVersion: "0.8.15",
      requiredCapability: "question-stream-v7",
    });
  });

  it("assigns prompt-first v5.12 ahead of the compatibility v5.11 rollout", () => {
    const canary = env(
      "disabled",
      "",
      "disabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "enabled",
      "",
      "canary",
      "learner-1",
    );
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "prompt_first_auto_v5_12",
      minimumExtensionVersion: "0.8.24",
      requiredCapability: "question-stream-v7",
    });
    expect(quizGenerationProfile(canary, "learner-2")).toEqual({
      generationProfile: "prompt_first_auto_v5_11",
      minimumExtensionVersion: "0.8.16",
      requiredCapability: "question-stream-v7",
    });
  });

  it("accepts a new legacy bank only while legacy is the assigned profile", () => {
    const disabled = env();
    expect(
      generationProfileAllowsNewBank(
        disabled,
        "learner-1",
        "legacy_reasoning_v5_1",
      ),
    ).toBe(true);
    expect(
      generationProfileAllowsNewBank(
        disabled,
        "learner-1",
        "concept_first_auto_v5_8",
      ),
    ).toBe(false);
  });
});
