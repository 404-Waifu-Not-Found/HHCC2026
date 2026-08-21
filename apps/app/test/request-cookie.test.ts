import { describe, expect, it, vi } from "vitest";
import { readNativeAuthCookie } from "../src/lib/request-cookie";

describe("readNativeAuthCookie", () => {
  it("does not touch native secure storage in browsers", () => {
    const getCookie = vi.fn(() => "session=secret");

    expect(readNativeAuthCookie("web", getCookie)).toBeUndefined();
    expect(getCookie).not.toHaveBeenCalled();
  });

  it("reads the Better Auth cookie on native platforms", () => {
    expect(readNativeAuthCookie("ios", () => "session=secret")).toBe("session=secret");
  });
});
