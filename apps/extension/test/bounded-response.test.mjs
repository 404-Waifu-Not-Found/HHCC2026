import assert from "node:assert/strict";
import test from "node:test";

await import("../src/bounded-response.js");
const { fetchBoundedText, readBoundedResponseText } =
  globalThis.ClipQuestBoundedResponse;

test("rejects a declared oversized response without reading its body", async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-length": "100" } },
  );
  await assert.rejects(
    readBoundedResponseText(response, { maxBytes: 16 }),
    /safe size limit/,
  );
  assert.equal(canceled, true);
});

test("rejects chunked overflow before buffering the complete response", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    }),
  );
  await assert.rejects(
    readBoundedResponseText(response, { maxBytes: 16 }),
    /safe size limit/,
  );
});

test("keeps the deadline active while a response body is stalled", async () => {
  const fetchImpl = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
      }),
    );
  await assert.rejects(
    fetchBoundedText(
      "https://www.youtube.com/api/timedtext",
      {},
      {
        fetchImpl,
        maxBytes: 128,
        timeoutMs: 10,
      },
    ),
    /timed out/,
  );
});

test("decodes split UTF-8 chunks within the response limit", async () => {
  const bytes = new TextEncoder().encode("学习 captions");
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    }),
  );
  assert.equal(
    await readBoundedResponseText(response, { maxBytes: bytes.length }),
    "学习 captions",
  );
});
