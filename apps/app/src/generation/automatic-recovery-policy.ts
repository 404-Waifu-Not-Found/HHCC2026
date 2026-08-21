import type {
  GenerationFailureCode,
  GenerationRecord,
} from "@clipquest/contracts";

export const GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES = 48;
export const GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT = 24;
export const GROUNDED_GENERATION_MAX_RECOVERY_CYCLES = 24;

export function groundedRecoveryIsExhausted(input: {
  reasonCode: GenerationFailureCode;
  record?: GenerationRecord | null;
  automaticRetryCount?: number;
  ordinalAttempt?: number;
}): boolean {
  if (input.reasonCode !== "recovery_budget_exhausted") return false;
  const record = input.record?.version === 4 ? input.record : undefined;
  return (
    Math.max(
      input.automaticRetryCount ?? 0,
      record?.automaticRetryCount ?? 0,
    ) >= GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES ||
    Math.max(input.ordinalAttempt ?? 0, record?.ordinalAttempt ?? 0) >=
      GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT ||
    (record?.recoveryCycle ?? 0) >= GROUNDED_GENERATION_MAX_RECOVERY_CYCLES
  );
}

export function groundedRecoveryCooldownMs(recoveryCycle: number): number {
  const boundedCycle = Math.max(0, Math.min(8, Math.trunc(recoveryCycle)));
  return Math.min(300_000, 5_000 * 2 ** boundedCycle);
}
