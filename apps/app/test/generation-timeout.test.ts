import { describe, expect, it } from "vitest";
import { GENERATION_POLL_TIMEOUT_MS, isGenerationPollExpired } from "../src/lib/generation-timeout";

describe("generation polling deadline", () => {
  it("stops polling at the deadline", () => {
    expect(isGenerationPollExpired(1_000, 1_000 + GENERATION_POLL_TIMEOUT_MS - 1)).toBe(false);
    expect(isGenerationPollExpired(1_000, 1_000 + GENERATION_POLL_TIMEOUT_MS)).toBe(true);
  });
});
