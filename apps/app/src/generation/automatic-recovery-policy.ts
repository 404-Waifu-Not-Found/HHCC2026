import type {
  GenerationFailureCode,
  GenerationRecord,
} from "@clipquest/contracts";

export const GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES = 48;
export const GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT = 24;
export const GROUNDED_GENERATION_MAX_RECOVERY_CYCLES = 24;
export const CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES = 12;
export const CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT = 7;
export const CONCEPT_ONLY_GENERATION_MAX_RECOVERY_CYCLES = 3;

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
  const boundedCycle = Math.max(0, Math.min(8, Math.trunc(recoveryCycle)));
  return Math.min(300_000, 5_000 * 2 ** boundedCycle);
}
