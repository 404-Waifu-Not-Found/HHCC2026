import type { GenerationFailureCode } from "@clipquest/contracts";

// A failed ordinal gets one primary call and at most two automatic repairs.
// Keep the app-side policy aligned with the local engine and API so each hot
// retry round is bounded before the next cooldown-based refill round starts.
export const GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES = 3;
export const GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT = 3;
export const CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES = 3;
export const CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT = 3;
// The persisted counter is diagnostic and selects the cooldown duration. It
// must never become a learner-facing stop condition: an incomplete bank keeps
// requesting only its missing suffix while the quiz is open.
export const AUTOMATIC_REFILL_MAX_TRACKED_CYCLES = 24;
export const AUTOMATIC_REFILL_MAX_TRACKED_ORDINAL_ATTEMPT = 24;

export function authoritativeRecoveryFailureCode(input: {
  requestReasonCode?: GenerationFailureCode;
  endedBeforeComplete?: boolean;
  latestModelFailureReason?: GenerationFailureCode;
}): GenerationFailureCode {
  if (input.requestReasonCode) return input.requestReasonCode;
  if (input.endedBeforeComplete && input.latestModelFailureReason) {
    return input.latestModelFailureReason;
  }
  return "local_state_conflict";
}

export function automaticRecoveryDisposition(
  reasonCode: GenerationFailureCode,
): "cooldown" | "action_required" | "generation_failed" {
  if (
    reasonCode === "credential_required" ||
    reasonCode === "billing_required"
  ) {
    return "action_required";
  }
  if (reasonCode === "non_instructional_source") {
    return "generation_failed";
  }
  // Caption acquisition can fail transiently when the extension bridge or a
  // signed YouTube track is late. Retry it in the same open quiz instead of
  // making the learner click a continuation control.
  // `recovery_budget_exhausted` ends one hot model-call round, not the whole
  // quiz. The next round receives a fresh bounded budget after cooldown.
  return "cooldown";
}

export function groundedRecoveryCooldownMs(recoveryCycle: number): number {
  const boundedCycle = Math.max(0, Math.trunc(recoveryCycle));
  return [2_000, 5_000, 15_000, 30_000][Math.min(3, boundedCycle)]!;
}
