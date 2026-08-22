import {
  AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  CONCEPT_FIRST_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  type LocalGenerationProfile,
} from "@clipquest/contracts";

export const MINIMUM_LOCAL_AI_EXTENSION_VERSION = "0.8.33";
// Workplace chat is a distinct local capability introduced with 0.8.32. Gate it
// on both the exact capability string and the first extension version that ships
// the website->background Workplace turn channel.
export const WORKPLACE_LOCAL_CHAT_CAPABILITY = "workplace-chat-v1" as const;
export const MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION = "0.8.32";
export const MINIMUM_PROMPT_FIRST_V511_LOCAL_AI_EXTENSION_VERSION = "0.8.16";
export const MINIMUM_PROMPT_FIRST_V510_LOCAL_AI_EXTENSION_VERSION = "0.8.15";
export const MINIMUM_PROMPT_FIRST_V59_LOCAL_AI_EXTENSION_VERSION = "0.8.14";
export const MINIMUM_CONCEPT_FIRST_LOCAL_AI_EXTENSION_VERSION = "0.8.13";
export const MINIMUM_GROUNDED_LOCAL_AI_EXTENSION_VERSION = "0.8.7";
export const MINIMUM_AUTOMATIC_LOCAL_AI_EXTENSION_VERSION = "0.8.3";
export const MINIMUM_STABLE_LOCAL_AI_EXTENSION_VERSION = "0.8.31";
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

export function supportsWorkplaceChat(
  capabilities: readonly string[],
): boolean {
  return capabilities.includes(WORKPLACE_LOCAL_CHAT_CAPABILITY);
}

export function supportsQuestionStream(
  capabilities: readonly string[],
  generationProfile: LocalGenerationProfile = "prompt_first_auto_v5_12",
): boolean {
  return capabilities.includes(
    generationProfile === "prompt_first_auto_v5_12" ||
      generationProfile === "prompt_first_auto_v5_11" ||
      generationProfile === "prompt_first_auto_v5_10" ||
      generationProfile === "prompt_first_auto_v5_9"
      ? LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
      : generationProfile === "concept_first_auto_v5_8"
        ? CONCEPT_FIRST_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
        : generationProfile === "evidence_grounded_auto_v5_4"
          ? GROUNDED_V5_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
          : generationProfile === "stable_auto_recovery_v5_3"
            ? AUTOMATIC_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
            : generationProfile === "stable_non_thinking_v5_2"
              ? STABLE_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY
              : LEGACY_LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  );
}
