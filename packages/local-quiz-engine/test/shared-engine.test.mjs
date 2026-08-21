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

test("local recovery uses a bounded three-attempt policy", () => {
  assert.deepEqual(shared.LOCAL_GENERATION_RETRY_POLICY, {
    maxTransportRetriesPerOrdinal: 2,
    maxContentRetriesPerOrdinal: 2,
    maxStructuralRetriesPerOrdinal: 2,
    maxAutomaticRetries: 3,
    maxHotRetriesPerRecoveryCycle: 3,
    maxActiveRecoveryMs: 5 * 60 * 1_000,
    streamIdleTimeoutMs: 60 * 1_000,
  });
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

function stableFullBankInput(fetchImpl) {
  return {
    title: "Photosynthesis",
    quizLanguage: "en",
    questionCount: 5,
    questionTypes: ["true_false"],
    jobId: "22222222-2222-4222-8222-222222222222",
    generationId: "33333333-3333-4333-8333-333333333333",
    generationSessionId: "44444444-4444-4444-8444-444444444444",
    recoverySessionId: "55555555-5555-4555-8555-555555555555",
    generationProfile: "stable_non_thinking_v5_2",
    transcriptFingerprint: "c".repeat(64),
    plainText:
      "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light. Carbon dioxide and water help produce glucose and oxygen. Plant cells perform this process in chloroplasts. Oxygen is released as a product. ".repeat(
        4,
      ),
    disableStreaming: true,
    fetchImpl,
  };
}

function completeStableBankResponse() {
  const facts = [
    [
      "Photosynthesis converts light energy into chemical energy.",
      "It stores captured light energy as chemical energy.",
    ],
    [
      "Chlorophyll absorbs light during photosynthesis.",
      "Chlorophyll is the light-absorbing pigment in this process.",
    ],
    [
      "Carbon dioxide is used to produce glucose.",
      "Carbon dioxide contributes material used to make glucose.",
    ],
    [
      "Plant cells perform photosynthesis in chloroplasts.",
      "Chloroplasts are the organelles where this process occurs.",
    ],
    [
      "Oxygen is released as a product of photosynthesis.",
      "The process produces and releases oxygen.",
    ],
  ];
  const questions = facts.map(([question, correction], index) => ({
    id: `q${index + 1}`,
    type: "true_false",
    concept: `photosynthesis concept ${index + 1}`,
    question,
    explanation: correction,
    answer: true,
    correction,
  }));
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ questions }) },
      },
    ],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 600,
      reasoning_tokens: 0,
    },
  });
}

test("stable v5.2 requests, validates, and publishes a complete bank in one call", async () => {
  let fetchCalls = 0;
  let requestBody;
  const chunks = [];
  const calls = [];
  const result = await shared.generateQuizFromPlainText(
    stableFullBankInput(async (_url, init) => {
      fetchCalls += 1;
      requestBody = JSON.parse(init.body);
      return new Response(completeStableBankResponse(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
    "private-test-key",
    () => undefined,
    undefined,
    async (chunk) => chunks.push(chunk),
    async (call) => calls.push(call),
  );

  assert.equal(fetchCalls, 1);
  assert.equal(requestBody.thinking.type, "disabled");
  assert.match(requestBody.messages.at(-1).content, /Create exactly 5/);
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.startIndex),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(calls, [
    {
      generationSessionId: "44444444-4444-4444-8444-444444444444",
      callIndex: 0,
      startIndex: 0,
      requestedCount: 5,
      acceptedCount: 5,
      classification: "primary",
      outcome: "complete",
      retryDelayMs: 0,
      elapsedMs: calls[0].elapsedMs,
      inputTokens: 900,
      outputTokens: 600,
      reasoningTokens: 0,
      usageComplete: true,
    },
  ]);
  assert.equal(result.metrics.aiCalls, 1);
  assert.equal(result.metrics.retryCount, 0);
});

test("stable v5.2 never retries a failed full-bank call", async () => {
  let fetchCalls = 0;
  const calls = [];
  await assert.rejects(
    shared.generateQuizFromPlainText(
      stableFullBankInput(async () => {
        fetchCalls += 1;
        return new Response('{"error":"busy"}', { status: 503 });
      }),
      "private-test-key",
      () => undefined,
      undefined,
      () => undefined,
      async (call) => calls.push(call),
    ),
    /temporarily unavailable/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestedCount, 5);
  assert.equal(calls[0].acceptedCount, 0);
  assert.equal(calls[0].retryDelayMs, 0);
  assert.equal(calls[0].outcome, "transient_http");
});
