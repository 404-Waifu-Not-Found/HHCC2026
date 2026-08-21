import {
  LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  QuizGenerationProfileResponseSchema,
  QuizGenerationRolloutModeSchema,
  type QuizGenerationProfileResponse,
  type QuizGenerationRolloutMode,
} from "@clipquest/contracts";
import type { AppEnv } from "../types";

export function quizGenerationRolloutMode(
  env: Pick<AppEnv, "QUIZ_V5_3_ROLLOUT">,
): QuizGenerationRolloutMode {
  return QuizGenerationRolloutModeSchema.catch("disabled").parse(
    env.QUIZ_V5_3_ROLLOUT,
  );
}

export function quizGenerationProfile(
  env: Pick<
    AppEnv,
    | "QUIZ_V5_2_ROLLOUT"
    | "QUIZ_V5_2_CANARY_USER_IDS"
    | "QUIZ_V5_3_ROLLOUT"
    | "QUIZ_V5_3_CANARY_USER_IDS"
  >,
  userId: string,
): QuizGenerationProfileResponse {
  const automaticMode = quizGenerationRolloutMode(env);
  const automaticCanaryUsers = new Set(
    String(env.QUIZ_V5_3_CANARY_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const automatic =
    automaticMode === "enabled" ||
    (automaticMode === "canary" && automaticCanaryUsers.has(userId));
  if (automatic) {
    return QuizGenerationProfileResponseSchema.parse({
      generationProfile: "stable_auto_recovery_v5_3",
      minimumExtensionVersion: "0.8.3",
      requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
    });
  }

  const stableMode = QuizGenerationRolloutModeSchema.catch("disabled").parse(
    env.QUIZ_V5_2_ROLLOUT,
  );
  const stableCanaryUsers = new Set(
    String(env.QUIZ_V5_2_CANARY_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const stable =
    stableMode === "enabled" ||
    (stableMode === "canary" && stableCanaryUsers.has(userId));
  return QuizGenerationProfileResponseSchema.parse(
    stable
      ? {
          generationProfile: "stable_non_thinking_v5_2",
          minimumExtensionVersion: "0.8.2",
          requiredCapability: STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
        }
      : {
          generationProfile: "legacy_reasoning_v5_1",
          minimumExtensionVersion: "0.8.0",
          requiredCapability: LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
        },
  );
}
