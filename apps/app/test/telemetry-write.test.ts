import { describe, expect, it, vi } from "vitest";
import { retryAuthoritativeTelemetryWrite } from "../src/generation/telemetry-write";

describe("authoritative telemetry writes", () => {
  it("retries a failed idempotent write without another model call", async () => {
    const controller = new AbortController();
    const write = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("summary changed concurrently"))
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValue("recorded");
    const wait = vi.fn(async () => undefined);

    await expect(
      retryAuthoritativeTelemetryWrite(write, controller.signal, { wait }),
    ).resolves.toBe("recorded");
    expect(write).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 125, controller.signal);
    expect(wait).toHaveBeenNthCalledWith(2, 250, controller.signal);
  });

  it("fails closed after the bounded write budget", async () => {
    const controller = new AbortController();
    const write = vi.fn(async () => {
      throw new Error("permanent conflict");
    });

    await expect(
      retryAuthoritativeTelemetryWrite(write, controller.signal, {
        attempts: 2,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("permanent conflict");
    expect(write).toHaveBeenCalledTimes(2);
  });
});
