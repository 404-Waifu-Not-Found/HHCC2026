import type {
  GenerationFailureCode,
  GenerationRecord,
} from "@clipquest/contracts";

// A failed ordinal gets one primary call and at most two automatic repairs.
// Keep the app-side policy aligned with the local engine and API so a stalled
// browser cannot spend an unbounded amount of time retrying the same suffix.
export const GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES = 3;
export const GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT = 3;
export const GROUNDED_GENERATION_MAX_RECOVERY_CYCLES = 3;
export const CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES = 3;
export const CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT = 3;
export const CONCEPT_ONLY_GENERATION_MAX_RECOVERY_CYCLES = 3;

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

export function groundedRecoveryIsExhausted(input: {
  reasonCode: GenerationFailureCode;
  record?: GenerationRecord | null;
  automaticRetryCount?: number;
  ordinalAttempt?: number;
  strictBudget?: boolean;
}): boolean {
  const record = input.record?.version === 4 ? input.record : undefined;
  const retryLimit = input.strictBudget
    ? CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES
    : GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES;
  const ordinalLimit = input.strictBudget
    ? CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT
    : GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT;
  const cycleLimit = input.strictBudget
    ? CONCEPT_ONLY_GENERATION_MAX_RECOVERY_CYCLES
    : GROUNDED_GENERATION_MAX_RECOVERY_CYCLES;
  if ((record?.recoveryCycle ?? 0) >= cycleLimit) return true;
  if (input.reasonCode !== "recovery_budget_exhausted") return false;
  return (
    Math.max(
      input.automaticRetryCount ?? 0,
      record?.automaticRetryCount ?? 0,
    ) >= retryLimit ||
    Math.max(input.ordinalAttempt ?? 0, record?.ordinalAttempt ?? 0) >=
      ordinalLimit
  );
}

export function groundedRecoveryCooldownMs(recoveryCycle: number): number {
  const boundedCycle = Math.max(0, Math.min(2, Math.trunc(recoveryCycle)));
  return Math.min(30_000, 2_000 * 2 ** boundedCycle);
}
