import { describe, expect, it, vi } from "vitest";
import {
  commitReviewReminderDisable,
  commitReviewReminderEnable,
} from "../src/notifications/review-reminder-state";

describe("review-reminder device state", () => {
  it("rolls back server registration when local persistence fails", async () => {
    const order: string[] = [];
    const storageError = new Error("storage unavailable");

    await expect(
      commitReviewReminderEnable({
        register: async () => void order.push("register"),
        persist: async () => {
          order.push("persist");
          throw storageError;
        },
        rollbackRegistration: async () => void order.push("rollback"),
      }),
    ).rejects.toBe(storageError);

    expect(order).toEqual(["register", "persist", "rollback"]);
  });

  it("keeps local state when server unregistration fails", async () => {
    const clear = vi.fn(async () => undefined);

    await expect(
      commitReviewReminderDisable({
        unregister: async () => {
          throw new Error("offline");
        },
        clear,
      }),
    ).rejects.toThrow("offline");

    expect(clear).not.toHaveBeenCalled();
  });

  it("clears local state only after server unregistration succeeds", async () => {
    const order: string[] = [];
    await commitReviewReminderDisable({
      unregister: async () => void order.push("unregister"),
      clear: async () => void order.push("clear"),
    });
    expect(order).toEqual(["unregister", "clear"]);
  });
});
