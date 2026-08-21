import { describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  OutboundRequestTimeoutError,
  OutboundResponseTooLargeError,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "../src/lib/outbound-response";

describe("bounded outbound responses", () => {
  it("rejects an oversized declared body without buffering it", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = {
      headers: new Headers({ "content-length": "33" }),
      body: { cancel },
    } as unknown as Response;

    await expect(readBoundedResponseText(response, 32)).rejects.toBeInstanceOf(
      OutboundResponseTooLargeError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a chunked body as soon as it crosses the byte limit", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("1234"));
          controller.enqueue(new TextEncoder().encode("5678"));
          controller.close();
        },
      }),
    );

    await expect(readBoundedResponseText(response, 7)).rejects.toBeInstanceOf(
      OutboundResponseTooLargeError,
    );
  });

  it("decodes bounded UTF-8 JSON across stream chunks", async () => {
    const bytes = new TextEncoder().encode('{"label":"猫"}');
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    );

    await expect(readBoundedResponseJson(response, 64)).resolves.toEqual({
      label: "猫",
    });
  });

  it("aborts an upstream request after its deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const request = fetchWithTimeout("https://example.com", {}, 50, fetcher);
    const rejection = expect(request).rejects.toBeInstanceOf(
      OutboundRequestTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });

  it("aborts a stalled upstream response body after its deadline", async () => {
    vi.useFakeTimers();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Deliberately leave the body open without producing bytes.
        },
      }),
    );
    const rejection = expect(
      readBoundedResponseText(response, 64, 50),
    ).rejects.toBeInstanceOf(OutboundRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    vi.useRealTimers();
  });
});
