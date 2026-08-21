import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_REQUEST_TIMEOUT_MS,
  apiRequest,
  readBoundedApiResponseText,
} from "../src/lib/api";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/lib/auth-client", () => ({
  authClient: { getCookie: () => "" },
}));
vi.mock("../src/lib/config", () => ({
  API_ORIGIN: "https://clipquest.test",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bounded ClipQuest API responses", () => {
  it("rejects a declared response that exceeds the device ceiling", async () => {
    const response = new Response("small body", {
      headers: { "content-length": "101" },
    });
    await expect(
      readBoundedApiResponseText(response, 100),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("rejects a chunked response once cumulative bytes exceed the ceiling", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345"));
          controller.enqueue(new TextEncoder().encode("67890"));
          controller.close();
        },
      }),
    );
    await expect(readBoundedApiResponseText(response, 9)).rejects.toMatchObject(
      {
        code: "response_too_large",
      },
    );
  });

  it("decodes UTF-8 split across response chunks", async () => {
    const bytes = new TextEncoder().encode("你好");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 2));
          controller.enqueue(bytes.slice(2));
          controller.close();
        },
      }),
    );
    await expect(readBoundedApiResponseText(response, 16)).resolves.toBe(
      "你好",
    );
  });

  it("aborts a request that never returns response headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );

    const request = apiRequest("/api/test-timeout");
    const rejection = expect(request).rejects.toEqual(
      expect.objectContaining({
        code: "request_timeout",
        status: 504,
      }),
    );
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;
  });
});
