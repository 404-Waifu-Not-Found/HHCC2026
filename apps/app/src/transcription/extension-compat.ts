import {
  AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  type LocalGenerationProfile,
} from "@clipquest/contracts";

export const MINIMUM_LOCAL_AI_EXTENSION_VERSION = "0.8.8";
export const MINIMUM_GROUNDED_LOCAL_AI_EXTENSION_VERSION = "0.8.7";
export const MINIMUM_AUTOMATIC_LOCAL_AI_EXTENSION_VERSION = "0.8.3";
export const MINIMUM_STABLE_LOCAL_AI_EXTENSION_VERSION = "0.8.2";
export const MINIMUM_LEGACY_LOCAL_AI_EXTENSION_VERSION = "0.8.0";

export function isCompatibleClipQuestExtensionVersion(
  version: string | undefined,
  minimumVersion = MINIMUM_LOCAL_AI_EXTENSION_VERSION,
): boolean {
  if (!version) return false;
  const actual = version.split(".").map((part) => Number(part));
  const required = minimumVersion.split(".").map((part) => Number(part));
  if (
    actual.length < 3 ||
    actual.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return false;
  }
  for (let index = 0; index < required.length; index += 1) {
    const requiredPart = required[index] ?? 0;
    if ((actual[index] ?? 0) > requiredPart) return true;
    if ((actual[index] ?? 0) < requiredPart) return false;
  }
  return true;
}

export function supportsQuestionStream(
  capabilities: readonly string[],
  generationProfile: LocalGenerationProfile = "concept_first_auto_v5_8",
): boolean {
  return capabilities.includes(
    generationProfile === "concept_first_auto_v5_8"
      ? LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
      : generationProfile === "evidence_grounded_auto_v5_4"
        ? GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
        : generationProfile === "stable_auto_recovery_v5_3"
          ? AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
          : generationProfile === "stable_non_thinking_v5_2"
            ? STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
            : LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  );
}
