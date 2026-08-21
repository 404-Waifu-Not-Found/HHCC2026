import { describe, expect, it } from "vitest";
import { hasConfirmedMinimumAge } from "../src/lib/age";

describe("minimum-age enforcement", () => {
  it("accepts only an explicit true value", () => {
    expect(hasConfirmedMinimumAge({ ageConfirmed: true })).toBe(true);
    expect(hasConfirmedMinimumAge({ ageConfirmed: false })).toBe(false);
    expect(hasConfirmedMinimumAge({})).toBe(false);
  });
});
