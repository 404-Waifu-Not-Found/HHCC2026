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

function stableProgressiveInput(fetchImpl, overrides = {}) {
  return {
    title: "Photosynthesis",
    quizLanguage: "en",
    questionCount: 5,
    questionTypes: ["multiple_choice"],
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
    ...overrides,
  };
}

function stableMultipleChoiceQuestion(index, overrides = {}) {
  const prompts = [
    "What kind of energy does photosynthesis store in glucose?",
    "Which pigment absorbs light during photosynthesis?",
    "Which gas supplies carbon used to produce glucose?",
    "In which organelle does photosynthesis occur in plant cells?",
    "Which gas is released as a product of photosynthesis?",
  ];
  const answers = [
    "Chemical energy",
    "Chlorophyll",
    "Carbon dioxide",
    "Chloroplast",
    "Oxygen",
  ];
  const answer = answers[index - 1];
  return {
    id: `q${index}`,
    type: "multiple_choice",
    concept: `photosynthesis concept ${index + 1}`,
    question: prompts[index - 1],
    explanation: `${answer} is the supported answer to this photosynthesis question.`,
    choices: [
      answer,
      `Distractor A ${index}`,
      `Distractor B ${index}`,
      `Distractor C ${index}`,
    ],
    answerIndex: 0,
    answer,
    ...overrides,
  };
}

function stableResponse(questions) {
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

test("stable v5.2 publishes question one before generating the suffix and automatically repairs one bad ordinal", async () => {
  let fetchCalls = 0;
  const requestBodies = [];
  const chunks = [];
  const calls = [];
  const result = await shared.generateQuizFromPlainText(
    stableProgressiveInput(async (_url, init) => {
      fetchCalls += 1;
      const requestBody = JSON.parse(init.body);
      requestBodies.push(requestBody);
      if (fetchCalls === 1) {
        assert.deepEqual(
          chunks.map((chunk) => chunk.startIndex),
          [],
        );
      } else if (fetchCalls === 2) {
        assert.deepEqual(
          chunks.map((chunk) => chunk.startIndex),
          [0],
        );
      } else if (fetchCalls === 3) {
        assert.deepEqual(
          chunks.map((chunk) => chunk.startIndex),
          [0, 1, 2],
        );
      }
      const questions =
        fetchCalls === 1
          ? [stableMultipleChoiceQuestion(1)]
          : fetchCalls === 2
            ? [
                stableMultipleChoiceQuestion(2),
                stableMultipleChoiceQuestion(3),
                stableMultipleChoiceQuestion(4, {
                  choices: ["Chloroplast", "Nucleus", "Nucleus", "Ribosome"],
                }),
              ]
            : fetchCalls === 3
              ? [stableMultipleChoiceQuestion(4)]
              : [stableMultipleChoiceQuestion(5)];
      return new Response(stableResponse(questions), {
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

  assert.equal(fetchCalls, 4);
  assert.equal(requestBodies[0].thinking.type, "disabled");
  assert.match(requestBodies[0].messages.at(-1).content, /Create exactly 1/);
  assert.match(requestBodies[1].messages.at(-1).content, /Create exactly 3/);
  assert.match(requestBodies[2].messages.at(-1).content, /automatic retry/);
  assert.match(requestBodies[2].messages.at(-1).content, /four unique choices/);
  assert.match(requestBodies[3].messages.at(-1).content, /Create exactly 1/);
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.startIndex),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    calls.map((call) => ({
      startIndex: call.startIndex,
      requestedCount: call.requestedCount,
      acceptedCount: call.acceptedCount,
      classification: call.classification,
      outcome: call.outcome,
    })),
    [
      {
        startIndex: 0,
        requestedCount: 1,
        acceptedCount: 1,
        classification: "primary",
        outcome: "complete",
      },
      {
        startIndex: 1,
        requestedCount: 3,
        acceptedCount: 2,
        classification: "primary",
        outcome: "answer_mapping_invalid",
      },
      {
        startIndex: 3,
        requestedCount: 1,
        acceptedCount: 1,
        classification: "automatic_retry",
        outcome: "complete",
      },
      {
        startIndex: 4,
        requestedCount: 1,
        acceptedCount: 1,
        classification: "primary",
        outcome: "complete",
      },
    ],
  );
  assert.equal(result.metrics.aiCalls, 4);
  assert.equal(result.metrics.retryCount, 1);
});

test("stable native JSON generation does not require a Web Streams body reader", async () => {
  let fetchCalls = 0;
  let bodyReads = 0;
  let randomCalls = 0;
  const chunks = [];
  const cryptoImpl = {
    subtle: {
      async digest() {
        return new Uint8Array(32).buffer;
      },
    },
    getRandomValues(values) {
      randomCalls += 1;
      values.fill(0x12345678);
      return values;
    },
    randomUUID() {
      return "11111111-1111-4111-8111-111111111111";
    },
  };
  const result = await shared.generateQuizFromPlainText(
    stableProgressiveInput(
      async () => {
        fetchCalls += 1;
        const startIndex = fetchCalls === 1 ? 1 : fetchCalls === 2 ? 2 : 5;
        const count = fetchCalls === 1 ? 1 : fetchCalls === 2 ? 3 : 1;
        const questions = Array.from({ length: count }, (_, index) =>
          stableMultipleChoiceQuestion(startIndex + index),
        );
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          get body() {
            bodyReads += 1;
            throw new TypeError("Native response body is not a Web Stream");
          },
          async text() {
            return stableResponse(questions);
          },
        };
      },
      { cryptoImpl },
    ),
    "private-test-key",
    () => undefined,
    undefined,
    async (chunk) => chunks.push(chunk),
  );

  assert.equal(fetchCalls, 3);
  assert.equal(bodyReads, 0);
  assert.ok(randomCalls > 0);
  assert.deepEqual(
    chunks.map((chunk) => chunk.startIndex),
    [0, 1, 2, 3, 4],
  );
  assert.equal(result.quiz.questions.length, 5);
});

test("classifies a fetch rejection as a transient network interruption", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    shared.generateQuizFromPlainText(
      stableProgressiveInput(async () => {
        fetchCalls += 1;
        throw new TypeError("Network request failed");
      }),
      "private-test-key",
      () => undefined,
    ),
    (error) =>
      error?.reasonCode === "network_interrupted" && error?.transient === true,
  );
  assert.equal(fetchCalls, 3);
});

test("does not misclassify a resolved response decoding bug as a network failure", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    shared.generateQuizFromPlainText(
      stableProgressiveInput(async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          async text() {
            throw new TypeError("Native response text bridge failed");
          },
        };
      }),
      "private-test-key",
      () => undefined,
    ),
    (error) =>
      error?.reasonCode === "schema_invalid" &&
      /Native response text bridge failed/.test(error?.message ?? ""),
  );
  assert.equal(fetchCalls, 3);
});

test("does not repeat an AI call when accepted-question persistence fails", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    shared.generateQuizFromPlainText(
      stableProgressiveInput(async () => {
        fetchCalls += 1;
        return new Response(stableResponse([stableMultipleChoiceQuestion(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
      "private-test-key",
      () => undefined,
      undefined,
      async () => {
        throw new TypeError("Native store unavailable");
      },
    ),
    (error) =>
      error?.reasonCode === "local_state_conflict" &&
      /Accepted question could not be stored: Native store unavailable/.test(
        error?.message ?? "",
      ),
  );
  assert.equal(fetchCalls, 1);
});

test("stable v5.2 does not retry an invalid credential", async () => {
  let fetchCalls = 0;
  const calls = [];
  await assert.rejects(
    shared.generateQuizFromPlainText(
      stableProgressiveInput(async () => {
        fetchCalls += 1;
        return new Response('{"error":"unauthorized"}', { status: 401 });
      }),
      "private-test-key",
      () => undefined,
      undefined,
      () => undefined,
      async (call) => calls.push(call),
    ),
    /rejected the configured API key/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestedCount, 1);
  assert.equal(calls[0].acceptedCount, 0);
  assert.equal(calls[0].retryDelayMs, 0);
  assert.equal(calls[0].outcome, "credential_required");
});

test("stable v5.2 resumes an accepted prefix without learner intervention", async () => {
  let fetchCalls = 0;
  const chunks = [];
  const calls = [];
  const seed = "d".repeat(64);
  const result = await shared.generateQuizFromPlainText(
    stableProgressiveInput(
      async () => {
        fetchCalls += 1;
        const questions =
          fetchCalls === 1
            ? [
                stableMultipleChoiceQuestion(2),
                stableMultipleChoiceQuestion(3),
                stableMultipleChoiceQuestion(4),
              ]
            : [stableMultipleChoiceQuestion(5)];
        return new Response(stableResponse(questions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      {
        continuation: {
          startIndex: 1,
          resultProtocolVersion: 6,
          promptVersion: "quiz-local-json-stream-v5.2",
          validatorVersion: "validator-local-progressive-v4.1",
          generationProfile: "stable_non_thinking_v5_2",
          questionPlan: {
            seed,
            types: shared.buildQuestionTypePlanFromSeed(
              ["multiple_choice"],
              5,
              seed,
            ),
          },
          nextCallIndex: 4,
          acceptedQuestions: [stableMultipleChoiceQuestion(1)],
        },
      },
    ),
    "private-test-key",
    () => undefined,
    undefined,
    async (chunk) => chunks.push(chunk),
    async (call) => calls.push(call),
  );

  assert.equal(fetchCalls, 2);
  assert.equal(result.generatedStartIndex, 1);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q2", "q3", "q4", "q5"],
  );
  assert.deepEqual(
    calls.map((call) => call.callIndex),
    [4, 5],
  );
  assert.ok(calls.every((call) => call.classification === "primary"));
});
