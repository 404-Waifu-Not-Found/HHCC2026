import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_REFILL_MAX_TRACKED_CYCLES,
  AUTOMATIC_REFILL_MAX_TRACKED_ORDINAL_ATTEMPT,
  automaticRecoveryDisposition,
  GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES,
  GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT,
  CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES,
  CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT,
  authoritativeRecoveryFailureCode,
  groundedRecoveryCooldownMs,
} from "../src/generation/automatic-recovery-policy";

describe("grounded automatic recovery policy", () => {
  it("uses increasing bounded cooldowns without becoming negative", () => {
    expect(groundedRecoveryCooldownMs(-1)).toBe(2_000);
    expect(groundedRecoveryCooldownMs(1)).toBe(5_000);
    expect(groundedRecoveryCooldownMs(2)).toBe(15_000);
    expect(groundedRecoveryCooldownMs(20)).toBe(30_000);
  });

  it("turns an exhausted hot retry round into another automatic refill", () => {
    expect(automaticRecoveryDisposition("schema_invalid")).toBe("cooldown");
    expect(automaticRecoveryDisposition("recovery_budget_exhausted")).toBe(
      "cooldown",
    );
    expect(automaticRecoveryDisposition("stream_idle_timeout")).toBe(
      "cooldown",
    );
  });

  it("keeps each refill round bounded without imposing a quiz-level cutoff", () => {
    expect(CONCEPT_ONLY_GENERATION_MAX_AUTOMATIC_RETRIES).toBe(3);
    expect(CONCEPT_ONLY_GENERATION_MAX_ORDINAL_ATTEMPT).toBe(3);
    expect(GROUNDED_GENERATION_MAX_AUTOMATIC_RETRIES).toBe(3);
    expect(GROUNDED_GENERATION_MAX_ORDINAL_ATTEMPT).toBe(3);
    expect(AUTOMATIC_REFILL_MAX_TRACKED_CYCLES).toBe(24);
    expect(AUTOMATIC_REFILL_MAX_TRACKED_ORDINAL_ATTEMPT).toBe(24);
  });

  it("stops only when AI generation is impossible without new source or account state", () => {
    expect(automaticRecoveryDisposition("credential_required")).toBe(
      "action_required",
    );
    expect(automaticRecoveryDisposition("billing_required")).toBe(
      "action_required",
    );
    expect(automaticRecoveryDisposition("source_unavailable")).toBe(
      "generation_failed",
    );
    expect(automaticRecoveryDisposition("non_instructional_source")).toBe(
      "generation_failed",
    );
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
