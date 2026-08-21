import { describe, expect, it } from "vitest";
import {
  GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES,
  GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT,
  CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES,
  CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT,
  authoritativeRecoveryFailureCode,
  groundedRecoveryCooldownMs,
  groundedRecoveryIsExhausted,
} from "../src/generation/automatic-recovery-policy";

describe("grounded automatic recovery policy", () => {
  it("uses increasing bounded cooldowns without becoming negative", () => {
    expect(groundedRecoveryCooldownMs(-1)).toBe(2_000);
    expect(groundedRecoveryCooldownMs(1)).toBe(4_000);
    expect(groundedRecoveryCooldownMs(20)).toBe(8_000);
  });

  it("stops only after a declared hard budget is genuinely exhausted", () => {
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "schema_invalid",
        automaticRetryCount: GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES,
      }),
    ).toBe(false);
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "recovery_budget_exhausted",
        automaticRetryCount: 2,
        ordinalAttempt: 2,
      }),
    ).toBe(false);
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "recovery_budget_exhausted",
        automaticRetryCount: GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES,
      }),
    ).toBe(true);
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "recovery_budget_exhausted",
        ordinalAttempt: GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT,
      }),
    ).toBe(true);
  });

  it("uses the high-stability automatic-only budget for concept-first banks", () => {
    expect(CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES).toBe(3);
    expect(CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT).toBe(3);
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "recovery_budget_exhausted",
        automaticRetryCount: 2,
        ordinalAttempt: 2,
        strictBudget: true,
      }),
    ).toBe(false);
    expect(
      groundedRecoveryIsExhausted({
        reasonCode: "recovery_budget_exhausted",
        automaticRetryCount: 3,
        strictBudget: true,
      }),
    ).toBe(true);
  });

  it("preserves the newest model outcome when an incomplete bank ends", () => {
    expect(
      authoritativeRecoveryFailureCode({
        endedBeforeComplete: true,
        latestModelFailureReason: "mc_evidence_span_invalid",
      }),
    ).toBe("mc_evidence_span_invalid");
    expect(
      authoritativeRecoveryFailureCode({
        requestReasonCode: "stream_idle_timeout",
        endedBeforeComplete: true,
        latestModelFailureReason: "duplicate_question",
      }),
    ).toBe("stream_idle_timeout");
    expect(authoritativeRecoveryFailureCode({})).toBe("local_state_conflict");
  });
});
