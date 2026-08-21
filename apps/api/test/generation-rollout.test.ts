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
): Pick<
  AppEnv,
  | "QUIZ_V5_2_ROLLOUT"
  | "QUIZ_V5_2_CANARY_USER_IDS"
  | "QUIZ_V5_3_ROLLOUT"
  | "QUIZ_V5_3_CANARY_USER_IDS"
  | "QUIZ_V5_4_ROLLOUT"
  | "QUIZ_V5_4_CANARY_USER_IDS"
> {
  return {
    QUIZ_V5_2_ROLLOUT: mode,
    QUIZ_V5_2_CANARY_USER_IDS: canaryUserIds,
    QUIZ_V5_3_ROLLOUT: automaticMode,
    QUIZ_V5_3_CANARY_USER_IDS: automaticCanaryUserIds,
    QUIZ_V5_4_ROLLOUT: groundedMode,
    QUIZ_V5_4_CANARY_USER_IDS: groundedCanaryUserIds,
  };
}

describe("quiz generation rollout", () => {
  it("fails closed to the compatible v5.1 profile", () => {
    expect(quizGenerationRolloutMode(env())).toBe("disabled");
    expect(quizGenerationRolloutMode(env("unexpected"))).toBe("disabled");
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

  it("requires extension 0.8.11 for the concept-first rollout", () => {
    const canary = env("enabled", "", "enabled", "", "canary", "learner-1");
    expect(quizGenerationProfile(canary, "learner-1")).toEqual({
      generationProfile: "concept_first_auto_v5_8",
      minimumExtensionVersion: "0.8.11",
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
