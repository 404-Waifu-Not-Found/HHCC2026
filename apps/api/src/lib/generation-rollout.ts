import {
  AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  QuizGenerationProfileResponseSchema,
  QuizGenerationRolloutModeSchema,
  type LocalGenerationProfile,
  type QuizGenerationProfileResponse,
  type QuizGenerationRolloutMode,
} from "@clipquest/contracts";
import type { AppEnv } from "../types";

export function quizGenerationRolloutMode(
  env: Pick<AppEnv, "QUIZ_V5_4_ROLLOUT">,
): QuizGenerationRolloutMode {
  return QuizGenerationRolloutModeSchema.catch("disabled").parse(
    env.QUIZ_V5_4_ROLLOUT,
  );
}

export function quizGenerationProfile(
  env: Pick<
    AppEnv,
    | "QUIZ_V5_2_ROLLOUT"
    | "QUIZ_V5_2_CANARY_USER_IDS"
    | "QUIZ_V5_3_ROLLOUT"
    | "QUIZ_V5_3_CANARY_USER_IDS"
    | "QUIZ_V5_4_ROLLOUT"
    | "QUIZ_V5_4_CANARY_USER_IDS"
  >,
  userId: string,
): QuizGenerationProfileResponse {
  const groundedMode = quizGenerationRolloutMode(env);
  const groundedCanaryUsers = new Set(
    String(env.QUIZ_V5_4_CANARY_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const grounded =
    groundedMode === "enabled" ||
    (groundedMode === "canary" && groundedCanaryUsers.has(userId));
  if (grounded) {
    return QuizGenerationProfileResponseSchema.parse({
      generationProfile: "concept_first_auto_v5_8",
      minimumExtensionVersion: "0.8.13",
      requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
    });
  }

  const automaticMode = QuizGenerationRolloutModeSchema.catch("disabled").parse(
    env.QUIZ_V5_3_ROLLOUT,
  );
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
      requiredCapability: AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
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

export function legacyGroundedQuizGenerationProfile(): QuizGenerationProfileResponse {
  return QuizGenerationProfileResponseSchema.parse({
    generationProfile: "evidence_grounded_auto_v5_4",
    minimumExtensionVersion: "0.8.7",
    requiredCapability: GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  });
}

export function generationProfileAllowsNewBank(
  env: Parameters<typeof quizGenerationProfile>[0],
  userId: string,
  requestedProfile: LocalGenerationProfile,
): boolean {
  return (
    quizGenerationProfile(env, userId).generationProfile === requestedProfile
  );
}
