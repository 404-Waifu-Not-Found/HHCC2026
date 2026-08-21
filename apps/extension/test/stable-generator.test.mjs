import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveChunkQuestionCount,
  boundedRetryDelayMilliseconds,
  buildQuestionTypePlanFromSeed,
  buildTrueFalseAnswerPlanFromSeed,
  generateQuizFromPlainText,
  normalizeGeneratedQuestion,
} from "../src/local-generator.js";

const IDS = {
  generation: "11111111-1111-4111-8111-111111111111",
  session: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
};

function stableInput(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    title: "Trusted source lesson title",
    quizLanguage: "en",
    questionCount,
    questionTypes,
    generationId: IDS.generation,
    generationSessionId: IDS.session,
    jobId: IDS.job,
    transcriptFingerprint: "1234abcd",
    plainText:
      "This complete lesson transcript explains supported concepts, examples, applications, and careful reasoning. ".repeat(
        12,
      ),
  };
}

function taskFromRequest(request) {
  const body = typeof request === "string" ? JSON.parse(request) : request;
  const task = body.messages.at(-1).content;
  const planText = task.match(
    /Mandatory slot plan:\n([\s\S]*?)\n\nAlready accepted questions/,
  )?.[1];
  assert.ok(planText, "request contains a bounded slot plan");
  const slots = planText.split("\n").map((line) => {
    const match = line.match(
      /^q(\d+): (multiple_choice|true_false|short_answer)(?:, answer=(true|false))?$/,
    );
    assert.ok(match, `valid slot line: ${line}`);
    return {
      ordinal: Number(match[1]),
      type: match[2],
      polarity: match[3] === undefined ? undefined : match[3] === "true",
    };
  });
  return { body, task, slots };
}

function questionForSlot(slot) {
  const marker = [
    "photosynthesis",
    "kinematics",
    "quotient",
    "ecosystem",
    "probability",
    "momentum",
    "derivative",
    "equilibrium",
    "mitosis",
    "algorithm",
    "geometry",
    "oxidation",
    "inference",
    "frequency",
    "integral",
  ][slot.ordinal - 1];
  const common = {
    id: `q${slot.ordinal}`,
    type: slot.type,
    concept: `Supported ${marker} concept`,
    question: `In the lesson's ${marker} example, which specific result is supported for case ${slot.ordinal}?`,
    explanation: `The lesson explicitly supports concept ${slot.ordinal}.`,
  };
  if (slot.type === "multiple_choice") {
    return {
      ...common,
      choices: [
        `Supported answer ${slot.ordinal}`,
        `Distractor A ${slot.ordinal}`,
        `Distractor B ${slot.ordinal}`,
        `Distractor C ${slot.ordinal}`,
      ],
      answerIndex: 0,
      answer: `Supported answer ${slot.ordinal}`,
    };
  }
  if (slot.type === "true_false") {
    return {
      ...common,
      answer: slot.polarity,
      correction: slot.polarity
        ? "The statement is accurate as written."
        : `The corrected statement for concept ${slot.ordinal} is supported.`,
    };
  }
  return {
    ...common,
    answer: `Complete reference answer ${slot.ordinal}`,
    rubricIdeas: [`Required idea ${slot.ordinal}`],
    acceptableAnswers: [],
  };
}

function completionResponse(value, finishReason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          message: {
            content: typeof value === "string" ? value : JSON.stringify(value),
          },
        },
      ],
      usage: {
        prompt_tokens: 101,
        completion_tokens: 37,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function responseForRequest(request, mutate = (value) => value) {
  const task = taskFromRequest(request);
  return completionResponse(
    mutate(
      {
        title: "A model title that must be ignored",
        questions: task.slots.map(questionForSlot),
      },
      task,
    ),
  );
}

function oneCharacterSseResponse(value, options = {}) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const pauseAfterQuestion = options.pauseAfterQuestion ?? false;
  const questionText = pauseAfterQuestion
    ? JSON.stringify(value.questions[0])
    : "";
  const splitIndex = pauseAfterQuestion
    ? source.indexOf(questionText) + questionText.length
    : 0;
  let release = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const frame = (payload, crlf = false) =>
    encoder.encode(
      `data: ${JSON.stringify(payload)}${crlf ? "\r\n\r\n" : "\n\n"}`,
    );
  const enqueue = (controller, content) => {
    for (const character of content) {
      controller.enqueue(
        frame(
          {
            choices: [{ finish_reason: null, delta: { content: character } }],
          },
          true,
        ),
      );
      controller.enqueue(encoder.encode(": keep-alive\r\n\r\n"));
    }
  };
  const response = new Response(
    new ReadableStream({
      async start(controller) {
        enqueue(controller, source.slice(0, splitIndex || undefined));
        if (splitIndex) await gate;
        if (splitIndex) enqueue(controller, source.slice(splitIndex));
        controller.enqueue(
          frame({ choices: [{ finish_reason: "stop", delta: {} }] }, true),
        );
        controller.enqueue(
          frame(
            {
              choices: [],
              usage: {
                prompt_tokens: 103,
                completion_tokens: 41,
                completion_tokens_details: { reasoning_tokens: 0 },
              },
            },
            true,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  return { response, release };
}

function interruptedSseResponse(value, acceptedCount) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const questionText = JSON.stringify(value.questions[acceptedCount - 1]);
  const splitIndex = source.indexOf(questionText) + questionText.length;
  let read = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (read) {
          controller.error(new Error("forced transport interruption"));
          return;
        }
        read = true;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  finish_reason: null,
                  delta: { content: source.slice(0, splitIndex) },
                },
              ],
            })}\n\n`,
          ),
        );
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function maxRun(values) {
  let maximum = 0;
  let current = 0;
  let previous;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    maximum = Math.max(maximum, current);
    previous = value;
  }
  return maximum;
}

test("v5.2 uses the stable non-thinking request profile and adaptive primary chunks", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    return responseForRequest(init.body);
  };

  const result = await generateQuizFromPlainText(
    stableInput(15, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.deepEqual(
    requests.map((request) => request.slots.length),
    [1, 3, 3, 3, 3, 2],
  );
  for (const request of requests) {
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    assert.equal(request.body.temperature, 0.2);
    assert.equal("reasoning_effort" in request.body, false);
    assert.equal("top_p" in request.body, false);
    assert.equal(
      request.body.max_tokens,
      request.slots.length === 1
        ? 4_096
        : request.slots.length === 2
          ? 6_144
          : 8_192,
    );
  }
  assert.equal(result.protocolVersion, 6);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.2");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.1");
  assert.equal(result.generationProfile, "stable_non_thinking_v5_2");
  assert.equal(result.quiz.title, "Trusted source lesson title");
  assert.equal(result.metrics.aiCalls, requests.length);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(calls.length, requests.length);
  assert.ok(calls.every((event) => event.classification === "primary"));
});

test("question one is emitted from one-character SSE before its response resolves", async (context) => {
  const originalFetch = globalThis.fetch;
  let firstStream;
  let fetchCount = 0;
  const chunks = [];
  let resolveFirst;
  const firstReady = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  context.after(() => {
    firstStream?.release();
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    const task = taskFromRequest(init.body);
    const value = { questions: task.slots.map(questionForSlot) };
    if (fetchCount === 1) {
      firstStream = oneCharacterSseResponse(value, {
        pauseAfterQuestion: true,
      });
      return firstStream.response;
    }
    return completionResponse(value);
  };

  let settled = false;
  const generation = generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => {
      chunks.push(chunk);
      if (chunk.startIndex === 0) resolveFirst();
    },
  ).finally(() => {
    settled = true;
  });

  await firstReady;
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].question.id, "q1");
  assert.equal(settled, false);
  assert.equal(fetchCount, 1);
  firstStream.release();
  const result = await generation;
  assert.equal(result.quiz.questions.length, 5);
});

test("one-character SSE supports every one-, two-, and three-question chunk shape", async (context) => {
  const originalFetch = globalThis.fetch;
  const observedSizes = new Set();
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    observedSizes.add(task.slots.length);
    return oneCharacterSseResponse({
      questions: task.slots.map(questionForSlot),
    }).response;
  };

  await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
  );
  await generateQuizFromPlainText(
    {
      ...stableInput(5, ["short_answer"]),
      generationId: "44444444-4444-4444-8444-444444444444",
      generationSessionId: "55555555-5555-4555-8555-555555555555",
    },
    "sk-local-test",
  );
  assert.deepEqual([...observedSizes].sort(), [1, 2, 3]);
});

test("safe normalization repairs only bounded representation differences", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value) => {
      value.questions = value.questions.map((question) => {
        if (question.type === "multiple_choice") {
          return {
            ...question,
            concept: `  ${question.concept}  `,
            answerIndex: "0",
            answer: question.answer.toUpperCase(),
            unknownModelField: "discard me",
          };
        }
        if (question.type === "true_false") {
          return {
            ...question,
            answer: String(question.answer).toUpperCase(),
            unknownModelField: true,
          };
        }
        const { acceptableAnswers: _optional, ...withoutOptional } = question;
        return { ...withoutOptional, unknownModelField: [] };
      });
      return value;
    });

  const result = await generateQuizFromPlainText(
    stableInput(),
    "sk-local-test",
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions.every(
      (question) => !("unknownModelField" in question),
    ),
  );
  assert.deepEqual(
    normalizeGeneratedQuestion({
      id: " q1 ",
      type: " true_false ",
      concept: " C ",
      question: " Q ",
      explanation: " E ",
      answer: "FALSE",
      correction: " fixed ",
    }),
    {
      id: "q1",
      type: "true_false",
      concept: "C",
      question: "Q",
      explanation: "E",
      answer: false,
      correction: "fixed",
    },
  );
});

for (const failure of [
  {
    name: "empty successful content",
    expected: "empty_content",
    input: stableInput(5, ["multiple_choice"]),
    response: () => completionResponse(""),
  },
  {
    name: "length finish",
    expected: "finish_length",
    input: stableInput(5, ["multiple_choice"]),
    response: () => completionResponse('{"questions":[', "length"),
  },
  {
    name: "wrong slot id",
    expected: "type_or_order_mismatch",
    input: stableInput(5, ["multiple_choice"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        value.questions[0].id = "q9";
        return value;
      }),
  },
  {
    name: "ambiguous choices",
    expected: "answer_mapping_invalid",
    input: stableInput(5, ["multiple_choice"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        value.questions[0].choices[1] = value.questions[0].choices[0];
        return value;
      }),
  },
  {
    name: "missing rubric",
    expected: "schema_invalid",
    input: stableInput(5, ["short_answer"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        delete value.questions[0].rubricIdeas;
        return value;
      }),
  },
]) {
  test(`${failure.name} pauses with zero automatic retries`, async (context) => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    const events = [];
    context.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async (_url, init) => {
      fetchCount += 1;
      return failure.response(init.body);
    };
    await assert.rejects(
      generateQuizFromPlainText(
        failure.input,
        "sk-local-test",
        () => undefined,
        undefined,
        () => undefined,
        (event) => events.push(event),
      ),
      (error) => error?.reasonCode === failure.expected,
    );
    assert.equal(fetchCount, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].classification, "primary");
    assert.equal(events[0].outcome, failure.expected);
  });
}

test("duplicate content pauses at the first missing ordinal without a blind request", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const chunks = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      if (fetchCount === 2 && value.questions.length > 1) {
        value.questions[1].question = value.questions[0].question;
      }
      return value;
    });
  };
  await assert.rejects(
    generateQuizFromPlainText(
      stableInput(5, ["multiple_choice"]),
      "sk-local-test",
      () => undefined,
      undefined,
      (chunk) => chunks.push(chunk),
      (event) => events.push(event),
    ),
    (error) => error?.reasonCode === "duplicate_question",
  );
  assert.equal(fetchCount, 2, "q1 plus one failed primary chunk");
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2"],
  );
  assert.equal(
    events.filter((event) => event.classification === "automatic_retry").length,
    0,
  );
  assert.equal(events.at(-1).acceptedCount, 1);
});

test("a confirmed transient failure receives exactly one automatic retry", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  const progress = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("", {
      status: fetchCount === 1 ? 429 : 503,
      headers: { "retry-after": "0.8" },
    });
  };
  await assert.rejects(
    generateQuizFromPlainText(
      stableInput(5, ["multiple_choice"]),
      "sk-local-test",
      (stage, value, detail) => progress.push({ stage, value, detail }),
      undefined,
      () => undefined,
      (event) => events.push(event),
    ),
    (error) => error?.reasonCode === "transient_http",
  );
  assert.equal(fetchCount, 2);
  assert.deepEqual(
    events.map((event) => event.classification),
    ["primary", "automatic_retry"],
  );
  assert.equal(events[0].retryDelayMs, 800);
  assert.equal(events[1].retryDelayMs, 0);
  assert.ok(
    progress.some(
      (event) =>
        event.detail.status === "retrying" &&
        event.detail.attempt === 2 &&
        event.detail.maxAttempts === 2 &&
        event.detail.retryDelayMs === 800,
    ),
  );
});

test("a transport close after every requested object does not waste the retry budget", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    const value = { questions: task.slots.map(questionForSlot) };
    return requests.length === 1
      ? interruptedSseResponse(value, task.slots.length)
      : completionResponse(value);
  };

  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );

  assert.deepEqual(
    requests.map((request) => request.slots.map((slot) => slot.ordinal)),
    [[1], [2, 3, 4], [5]],
  );
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.equal(events[0].outcome, "network_interrupted");
  assert.equal(events[0].acceptedCount, events[0].requestedCount);
});

test("a partial transport failure preserves accepted questions and retries only the first missing slot", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const chunks = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    const value = { questions: task.slots.map(questionForSlot) };
    if (requests.length === 2) return interruptedSseResponse(value, 2);
    return completionResponse(value);
  };

  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );
  assert.deepEqual(
    requests.map((request) => request.slots.map((slot) => slot.ordinal)),
    [[1], [2, 3, 4], [4], [5]],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(events.length, requests.length);
  assert.equal(events[1].acceptedCount, 2);
  assert.equal(events[1].outcome, "network_interrupted");
  assert.equal(events[2].classification, "automatic_retry");
});

test("stable prompt prefixes are byte-identical while suffix tasks evolve", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
  );
  assert.ok(requests.length > 1);
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.messages[0], requests[0].messages[0]);
    assert.deepEqual(request.messages[1], requests[0].messages[1]);
  }
  assert.notEqual(
    requests[0].messages[2].content,
    requests[1].messages[2].content,
  );
  assert.match(
    requests[0].messages[1].content,
    /Complete plain-text lesson transcript/,
  );
  assert.match(requests[1].messages[2].content, /Already accepted questions/);
});

test("v5.1 continuation remains isolated on its original metadata", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const accepted = [
    {
      id: "q1",
      type: "multiple_choice",
      concept: "Supported concept 1",
      question: "How does supported concept 1 apply to scenario 1?",
    },
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    {
      ...stableInput(),
      continuation: {
        startIndex: 1,
        resultProtocolVersion: 5,
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
        generationProfile: "legacy_reasoning_v5_1",
        acceptedQuestions: accepted,
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(result.protocolVersion, 5);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.1");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.0");
  assert.ok(requests.every((request) => request.thinking.type === "enabled"));
  assert.ok(requests.every((request) => request.reasoning_effort === "high"));
  assert.ok(
    events.every((event) => event.classification === "manual_continuation"),
  );
});

test("a disabled rollout can start a new bank on the v5.1 profile", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    {
      ...stableInput(),
      generationProfile: "legacy_reasoning_v5_1",
    },
    "sk-local-test",
  );
  assert.equal(result.protocolVersion, 5);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.1");
  assert.equal(result.generationProfile, "legacy_reasoning_v5_1");
  assert.ok(requests.every((request) => request.thinking.type === "enabled"));
});

test("10,000 seeded plans are balanced, reproducible, and avoid avoidable runs", () => {
  let observedRepeatedPolarity = false;
  for (let index = 0; index < 10_000; index += 1) {
    const seed = index.toString(16).padStart(64, "0");
    const types = buildQuestionTypePlanFromSeed(
      ["multiple_choice", "true_false", "short_answer"],
      15,
      seed,
    );
    assert.deepEqual(
      buildQuestionTypePlanFromSeed(
        ["multiple_choice", "true_false", "short_answer"],
        15,
        seed,
      ),
      types,
    );
    assert.equal(types[0], "multiple_choice");
    assert.ok(maxRun(types) <= 2);
    const counts = ["multiple_choice", "true_false", "short_answer"].map(
      (type) => types.filter((candidate) => candidate === type).length,
    );
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);

    const polarity = buildTrueFalseAnswerPlanFromSeed(types, seed).filter(
      (value) => typeof value === "boolean",
    );
    const trueCount = polarity.filter(Boolean).length;
    assert.ok(Math.abs(trueCount - (polarity.length - trueCount)) <= 1);
    assert.ok(maxRun(polarity) <= 2);
    if (maxRun(polarity) === 2) observedRepeatedPolarity = true;
  }
  assert.equal(observedRepeatedPolarity, true);
  assert.deepEqual(
    buildQuestionTypePlanFromSeed(["short_answer"], 5, "f".repeat(64)),
    Array(5).fill("short_answer"),
  );
});

test("adaptive chunk sizing is singleton-first and bounded by short answers", () => {
  assert.equal(adaptiveChunkQuestionCount(["multiple_choice"], 0), 1);
  assert.equal(
    adaptiveChunkQuestionCount(
      [
        "multiple_choice",
        "multiple_choice",
        "multiple_choice",
        "multiple_choice",
      ],
      1,
    ),
    3,
  );
  assert.equal(
    adaptiveChunkQuestionCount(
      ["multiple_choice", "short_answer", "multiple_choice", "true_false"],
      1,
    ),
    2,
  );
  assert.equal(boundedRetryDelayMilliseconds(1, 30_000), 30_000);
  assert.equal(boundedRetryDelayMilliseconds(1, 900_000), 300_000);
});
