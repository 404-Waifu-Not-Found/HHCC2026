import { describe, expect, it } from "vitest";
import { createLocalCrypto } from "../src/generation/local-crypto";

describe("local native crypto adapter", () => {
  it("produces the standard SHA-256 digest without a native global", async () => {
    const crypto = createLocalCrypto(["digest-test"]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from([0x61, 0x62, 0x63]),
    );
    expect(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("fills typed-array views reproducibly without global getRandomValues", () => {
    const first = createLocalCrypto(["generation-1", "session-1"]);
    const second = createLocalCrypto(["generation-1", "session-1"]);
    const firstValues = first.getRandomValues(new Uint32Array(8));
    const secondValues = second.getRandomValues(new Uint32Array(8));

    expect(Array.from(firstValues)).toEqual(Array.from(secondValues));
    expect(firstValues.some((value) => value !== 0)).toBe(true);
    expect(first.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
