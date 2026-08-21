import { describe, expect, it } from "vitest";
import {
  quizGenerationProfile,
  quizGenerationRolloutMode,
} from "../src/lib/generation-rollout";
import type { AppEnv } from "../src/types";

function env(
  mode?: string,
  canaryUserIds = "",
): Pick<AppEnv, "QUIZ_V5_2_ROLLOUT" | "QUIZ_V5_2_CANARY_USER_IDS"> {
  return {
    QUIZ_V5_2_ROLLOUT: mode,
    QUIZ_V5_2_CANARY_USER_IDS: canaryUserIds,
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
});
