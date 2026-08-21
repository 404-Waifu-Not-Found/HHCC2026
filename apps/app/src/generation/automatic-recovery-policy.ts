import type { GenerationFailureCode } from "@clipquest/contracts";

// A failed ordinal gets one primary call and at most two automatic repairs.
// Keep the app-side policy aligned with the local engine and API so a stalled
// browser cannot spend an unbounded amount of time retrying the same suffix.
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
  if (
    reasonCode === "source_unavailable" ||
    reasonCode === "non_instructional_source"
  ) {
    return "generation_failed";
  }
  // `recovery_budget_exhausted` ends one hot model-call round, not the whole
  // quiz. The next round receives a fresh bounded budget after cooldown.
  return "cooldown";
}

export function groundedRecoveryCooldownMs(recoveryCycle: number): number {
  const boundedCycle = Math.max(0, Math.trunc(recoveryCycle));
  return [2_000, 5_000, 15_000, 30_000][Math.min(3, boundedCycle)]!;
}
