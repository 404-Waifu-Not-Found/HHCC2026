import assert from "node:assert/strict";
import test from "node:test";
import * as shared from "../index.js";
import * as extensionFacade from "../../../apps/extension/src/local-generator.js";

test("Chrome and Android import the same generation engine", () => {
  assert.equal(extensionFacade.generateLocalQuiz, shared.generateLocalQuiz);
  assert.equal(
    extensionFacade.randomizeMultipleChoiceOptions,
    shared.randomizeMultipleChoiceOptions,
  );
});

test("credential checks use the injected platform transport", async () => {
  let request;
  await shared.testDeepSeekKey("private-test-key", async (url, init) => {
    request = { url, init };
    return new Response("{}", { status: 200 });
  });
  assert.equal(request.url, "https://api.deepseek.com/models");
  assert.equal(request.init.headers.Authorization, "Bearer private-test-key");
});

test("native generation uses injected secure cryptography instead of browser globals", async () => {
  let digestCalls = 0;
  let randomCalls = 0;
  let fetchCalls = 0;
  const cryptoImpl = {
    subtle: {
      async digest() {
        digestCalls += 1;
        return new Uint8Array(32).buffer;
      },
    },
    getRandomValues(values) {
      randomCalls += 1;
      values.fill(7);
      return values;
    },
    randomUUID() {
      return "11111111-1111-4111-8111-111111111111";
    },
  };
  await assert.rejects(
    shared.generateQuizFromPlainText(
      {
        title: "Photosynthesis",
        quizLanguage: "en",
        questionCount: 5,
        questionTypes: ["multiple_choice"],
        jobId: "22222222-2222-4222-8222-222222222222",
        generationId: "33333333-3333-4333-8333-333333333333",
        generationSessionId: "44444444-4444-4444-8444-444444444444",
        recoverySessionId: "55555555-5555-4555-8555-555555555555",
        generationProfile: "prompt_first_auto_v5_12",
        transcriptFingerprint: "a".repeat(64),
        plainText:
          "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light, and carbon dioxide and water are used to produce glucose and oxygen. ".repeat(
            8,
          ),
        cryptoImpl,
        async fetchImpl() {
          fetchCalls += 1;
          return new Response('{"error":"unauthorized"}', { status: 401 });
        },
      },
      "private-test-key",
    ),
    /DeepSeek rejected the configured API key/,
  );
  assert.ok(digestCalls > 0);
  assert.ok(randomCalls > 0);
  assert.equal(fetchCalls, 1);
});

function boundedGenerationInput(fetchImpl) {
  return {
    title: "Cell membranes",
    quizLanguage: "en",
    questionCount: 5,
    questionTypes: ["multiple_choice"],
    jobId: "22222222-2222-4222-8222-222222222222",
    generationId: "33333333-3333-4333-8333-333333333333",
    generationSessionId: "44444444-4444-4444-8444-444444444444",
    recoverySessionId: "55555555-5555-4555-8555-555555555555",
    generationProfile: "prompt_first_auto_v5_12",
    transcriptFingerprint: "b".repeat(64),
    plainText:
      "Cell membranes regulate transport between a cell and its environment. ".repeat(
        12,
      ),
    fetchImpl,
  };
}

test("rejects an oversized non-streaming DeepSeek envelope before buffering it", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    shared.generateQuizFromPlainText(
      boundedGenerationInput(async () => {
        fetchCalls += 1;
        return new Response("{}", {
          status: 200,
          headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
        });
      }),
      "private-test-key",
    ),
    /more data than ClipQuest can process safely/,
  );
  assert.equal(fetchCalls, 1);
});

test("rejects a delimiter-free oversized SSE frame", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    shared.generateQuizFromPlainText(
      boundedGenerationInput(async () => {
        fetchCalls += 1;
        return new Response(`data: ${"x".repeat(513 * 1024)}`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
      "private-test-key",
    ),
    /more data than ClipQuest can process safely/,
  );
  assert.equal(fetchCalls, 1);
});
