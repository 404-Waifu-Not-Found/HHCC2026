import { describe, expect, it } from "vitest";
import {
  classifyExpoPushTickets,
  DEVICE_TOKEN_REASSIGN_SQL,
  DEVICE_TOKEN_UPSERT_SQL,
  isValidExpoPushToken,
} from "../src/routes/push";

describe("push token ownership", () => {
  it("validates Expo tokens and reassigns a physical token between users", () => {
    expect(isValidExpoPushToken("ExponentPushToken[abcdefgh1234]")).toBe(true);
    expect(isValidExpoPushToken("not-a-token")).toBe(false);
    expect(DEVICE_TOKEN_REASSIGN_SQL).toContain(
      "WHERE token = ? AND user_id <> ?",
    );
    expect(DEVICE_TOKEN_UPSERT_SQL).toContain("ON CONFLICT(user_id, token)");
  });

  it("marks only successful reviews and prunes unregistered devices", () => {
    const valid = "ExponentPushToken[abcdefgh1234]";
    const invalid = "ExponentPushToken[zyxwvuts9876]";
    expect(
      classifyExpoPushTickets(
        [
          { review_id: "review-a", token: valid },
          { review_id: "review-b", token: invalid },
          { review_id: "review-c", token: valid },
        ],
        [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "error", details: { error: "MessageTooBig" } },
        ],
      ),
    ).toEqual({
      deliveredReviewIds: ["review-a"],
      invalidTokens: [invalid],
    });
    expect(classifyExpoPushTickets([], [{ status: "ok" }])).toBeNull();
  });
});
