import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PENDING_VIDEO_HANDOFF_TTL_MS,
  PendingVideoHandoffV2Schema,
  claimPendingVideoHandoffRecord,
  createPendingVideoHandoffRecord,
} from "../src/state/pending-video-handoff-core";

const youtubeUrl = "https://www.youtube.com/watch?v=SVb9OV0bLzI";

describe("pending video handoff v2", () => {
  it("creates a strict two-hour unowned welcome record and claims it once", () => {
    const handoff = createPendingVideoHandoffRecord({
      id: "11111111-1111-4111-8111-111111111111",
      url: youtubeUrl,
      source: "welcome",
      nowMs: 10_000,
    });
    expect(handoff).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      url: youtubeUrl,
      source: "welcome",
      createdAt: 10_000,
      expiresAt: 10_000 + PENDING_VIDEO_HANDOFF_TTL_MS,
      state: "pending",
    });
    expect(claimPendingVideoHandoffRecord(handoff, "user-a", 20_000)).toEqual({
      ...handoff,
      claimedUserId: "user-a",
    });
  });

  it("discards expired and cross-account records", () => {
    const claimed = createPendingVideoHandoffRecord({
      id: "22222222-2222-4222-8222-222222222222",
      url: youtubeUrl,
      source: "quick_open",
      claimedUserId: "user-a",
      nowMs: 1_000,
    });
    expect(claimPendingVideoHandoffRecord(claimed, "user-b", 2_000)).toBeNull();
    expect(
      claimPendingVideoHandoffRecord(claimed, "user-a", claimed.expiresAt),
    ).toBeNull();
  });

  it("allows an intentional repeat of the same video only with a new UUID", () => {
    const first = createPendingVideoHandoffRecord({
      id: "33333333-3333-4333-8333-333333333333",
      url: youtubeUrl,
      source: "quick_open",
      claimedUserId: "user-a",
      nowMs: 1_000,
    });
    const second = createPendingVideoHandoffRecord({
      id: "44444444-4444-4444-8444-444444444444",
      url: youtubeUrl,
      source: "quick_open",
      claimedUserId: "user-a",
      nowMs: 2_000,
    });
    expect(first.url).toBe(second.url);
    expect(first.id).not.toBe(second.id);
  });

  it("rejects malformed, overlong, and unsupported records", () => {
    const valid = createPendingVideoHandoffRecord({
      id: "55555555-5555-4555-8555-555555555555",
      url: youtubeUrl,
      source: "welcome",
      nowMs: 1_000,
    });
    expect(
      PendingVideoHandoffV2Schema.safeParse({
        ...valid,
        expiresAt: valid.expiresAt + 1,
      }).success,
    ).toBe(false);
    expect(
      PendingVideoHandoffV2Schema.safeParse({
        ...valid,
        url: "https://example.com/video",
      }).success,
    ).toBe(false);
    expect(
      PendingVideoHandoffV2Schema.safeParse({ ...valid, transcript: "no" })
        .success,
    ).toBe(false);
  });

  it("uses tab-scoped web storage and requires manual recovery after reload", () => {
    const stateSource = readFileSync(
      resolve(import.meta.dirname, "../src/state/pending-video-handoff.ts"),
      "utf8",
    );
    const homeSource = readFileSync(
      resolve(import.meta.dirname, "../app/(tabs)/index.tsx"),
      "utf8",
    );
    const settingsSource = readFileSync(
      resolve(import.meta.dirname, "../app/(tabs)/settings.tsx"),
      "utf8",
    );
    const signInSource = readFileSync(
      resolve(import.meta.dirname, "../app/(auth)/sign-in.tsx"),
      "utf8",
    );
    const signUpSource = readFileSync(
      resolve(import.meta.dirname, "../app/(auth)/sign-up.tsx"),
      "utf8",
    );

    expect(stateSource).toContain("window.sessionStorage");
    expect(stateSource).toContain("AsyncStorage.removeItem");
    expect(stateSource).not.toMatch(/setItem\([^)]*pending-url:v1/);
    expect(homeSource).toMatch(
      /handoff\.state === "in_flight"[\s\S]+"retry_required"/,
    );
    expect(homeSource).toMatch(
      /if \(handoff\.state === "pending"\)[\s\S]+importVideo/,
    );
    const quickOpenEffect = homeSource.slice(
      homeSource.indexOf("consumedQuickOpenUrl.current = quickOpenUrl"),
    );
    expect(quickOpenEffect.indexOf("router.setParams")).toBeLessThan(
      quickOpenEffect.indexOf("createAndSavePendingVideoHandoff"),
    );
    expect(settingsSource.match(/clearPendingVideoHandoffs/g)).toHaveLength(3);
    for (const authSource of [signInSource, signUpSource]) {
      expect(authSource).toContain("persistAuthJourneyQuickOpenHandoff");
      expect(authSource).toMatch(/pathname: "\/\(auth\)\/sign-(?:in|up)"/);
      expect(authSource).toContain("withNextParam(quickOpen, next)");
      expect(authSource).toContain("params: authLinkParams");
    }
  });
});
