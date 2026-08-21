import {
  LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  QuizGenerationProfileResponseSchema,
  QuizGenerationRolloutModeSchema,
  type QuizGenerationProfileResponse,
  type QuizGenerationRolloutMode,
} from "@clipquest/contracts";
import type { AppEnv } from "../types";

export function quizGenerationRolloutMode(
  env: Pick<AppEnv, "QUIZ_V5_2_ROLLOUT">,
): QuizGenerationRolloutMode {
  return QuizGenerationRolloutModeSchema.catch("disabled").parse(
    env.QUIZ_V5_2_ROLLOUT,
  );
}

export function quizGenerationProfile(
  env: Pick<AppEnv, "QUIZ_V5_2_ROLLOUT" | "QUIZ_V5_2_CANARY_USER_IDS">,
  userId: string,
): QuizGenerationProfileResponse {
  const mode = quizGenerationRolloutMode(env);
  const canaryUsers = new Set(
    String(env.QUIZ_V5_2_CANARY_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const stable =
    mode === "enabled" || (mode === "canary" && canaryUsers.has(userId));
  return QuizGenerationProfileResponseSchema.parse(
    stable
      ? {
          generationProfile: "stable_non_thinking_v5_2",
          minimumExtensionVersion: "0.8.2",
          requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
        }
      : {
          generationProfile: "legacy_reasoning_v5_1",
          minimumExtensionVersion: "0.8.0",
          requiredCapability: LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
        },
  );
}

export function stableQuizGenerationEnabled(
  env: Pick<AppEnv, "QUIZ_V5_2_ROLLOUT" | "QUIZ_V5_2_CANARY_USER_IDS">,
  userId: string,
): boolean {
  return (
    quizGenerationProfile(env, userId).generationProfile ===
    "stable_non_thinking_v5_2"
  );
}
