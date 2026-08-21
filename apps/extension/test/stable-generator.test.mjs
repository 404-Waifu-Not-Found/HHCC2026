import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveChunkQuestionCount,
  boundedRetryDelayMilliseconds,
  buildQuestionTypePlanFromSeed,
  buildTrueFalseAnswerPlanFromSeed,
  generateQuizFromPlainText,
  normalizeGeneratedQuestion,
  serializeFormulaTokens,
} from "../src/local-generator.js";

const IDS = {
  generation: "11111111-1111-4111-8111-111111111111",
  session: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  recovery: "44444444-4444-4444-8444-444444444444",
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
    recoverySessionId: IDS.recovery,
    jobId: IDS.job,
    generationProfile: "stable_auto_recovery_v5_3",
    transcriptFingerprint: "1234abcd",
    plainText:
      "This complete lesson transcript explains supported concepts, examples, applications, and careful reasoning. ".repeat(
        12,
      ),
  };
}

function groundedInput(questionCount = 5, questionTypes = ["multiple_choice"]) {
  return {
    ...stableInput(questionCount, questionTypes),
    generationProfile: "evidence_grounded_auto_v5_4",
    plainText: Array.from(
      { length: 20 },
      (_, index) =>
        `Instructional claim ${index + 1} explains that supported value ${index + 1} is ${(index + 1) * 3} units because the measured relationship is explicit.`,
    ).join(" "),
  };
}

function taskFromRequest(request) {
  const body = typeof request === "string" ? JSON.parse(request) : request;
  const task = body.messages.at(-1).content;
  const planText = task.match(
    /Mandatory slot plan:\n([\s\S]*?)\n\n(?:Primary source focus|Already accepted questions)/,
  )?.[1];
  assert.ok(planText, "request contains a bounded slot plan");
  const slots = planText.split("\n").map((line) => {
    const match = line.match(
      /^q(\d+): (multiple_choice|true_false|short_answer)(?:, (?:answer|preferred_answer)=(true|false))?$/,
    );
    assert.ok(match, `valid slot line: ${line}`);
    return {
      ordinal: Number(match[1]),
      type: match[2],
      polarity: match[3] === undefined ? undefined : match[3] === "true",
    };
  });
  const focusExcerpt = task.match(
    /Primary source focus for this slot; use only instructional claims copied from this excerpt:\n([\s\S]*?)\n\nAlready accepted questions/,
  )?.[1];
  return { body, task, slots, focusExcerpt };
}

function groundedQuestionForSlot(slot, focusExcerpt) {
  const evidenceSentences = String(focusExcerpt)
    .split(/(?<=[.!?])\s+/u)
    .filter(Boolean);
  const evidence = evidenceSentences[slot.ordinal % evidenceSentences.length];
  assert.ok(evidence, "grounded task contains a usable evidence sentence");
  const correctAnswer = evidence.match(
    /supported value \d+ is \d+ units/iu,
  )?.[0];
  assert.ok(correctAnswer, "grounded evidence contains an exact answer phrase");
  const prompts = [
    `What exact supported value is reported for instructional claim ${slot.ordinal}?`,
    `How many units does instructional claim ${slot.ordinal} report?`,
    `Select the measurement explicitly tied to instructional claim ${slot.ordinal}.`,
    `Which numerical result appears in the evidence for instructional claim ${slot.ordinal}?`,
    `Name the measured quantity stated by instructional claim ${slot.ordinal}.`,
  ];
  const common = {
    id: `q${slot.ordinal}`,
    type: slot.type,
    concept: `Grounded measurement ${slot.ordinal}`,
    explanation: `The source evidence explicitly states ${correctAnswer}.`,
    sourceEvidence: evidence,
    claim: {
      subject: `instructional claim ${slot.ordinal}`,
      relation: "reports",
      value: correctAnswer,
      cluster: `grounded measurement ${slot.ordinal}`,
    },
  };
  if (slot.type === "true_false") {
    return {
      ...common,
      question: evidence,
      supportedStatement: evidence,
      mode: "supported",
      mutation: null,
    };
  }
  if (slot.type === "short_answer") {
    return {
      ...common,
      question: prompts[(slot.ordinal - 1) % prompts.length],
      answer: correctAnswer,
      rubricIdeas: [correctAnswer],
      acceptableAnswers: [],
    };
  }
  return {
    ...common,
    question: prompts[(slot.ordinal - 1) % prompts.length],
    correctAnswer,
    distractors: [1, 2, 3].map((offset) => ({
      text: `${Number(correctAnswer.match(/\d+(?= units)/u)?.[0]) + offset} units for claim ${slot.ordinal}`,
      whyWrong:
        "This value is not the exact measurement stated in the evidence.",
    })),
  };
}

function questionForSlot(slot, automaticMode = true) {
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
    question: `Which specific ${marker} result is supported for case ${slot.ordinal}?`,
    explanation: `The stated relationship supports concept ${slot.ordinal}.`,
  };
  if (slot.type === "multiple_choice") {
    if (!automaticMode) {
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
    return {
      ...common,
      correctAnswer: `Supported answer ${slot.ordinal}`,
      distractors: [
        `Distractor A ${slot.ordinal}`,
        `Distractor B ${slot.ordinal}`,
        `Distractor C ${slot.ordinal}`,
      ],
    };
  }
  if (slot.type === "true_false") {
    const answer =
      typeof slot.polarity === "boolean"
        ? slot.polarity
        : slot.ordinal % 2 === 0;
    return {
      ...common,
      answer,
      correction: answer
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

function formulaTokens(expression) {
  const matches = expression.match(
    /\p{L}[\p{L}\p{N}_]*|\d+(?:\.\d+)?|[+\-*/^=(),']/gu,
  );
  assert.equal(matches?.join(""), expression);
  return matches.map((value) => ({
    kind: /^[\p{L}_]/u.test(value)
      ? "identifier"
      : /^\d/.test(value)
        ? "number"
        : value === "("
          ? "left_paren"
          : value === ")"
            ? "right_paren"
            : value === ","
              ? "comma"
              : value === "'"
                ? "prime"
                : "operator",
    value,
  }));
}

function responseForRequest(request, mutate = (value) => value) {
  const task = taskFromRequest(request);
  const automaticMode = task.body.messages[0].content.includes(
    "return one correctAnswer",
  );
  const groundedMode = task.body.messages[0].content.includes(
    "sourceEvidence copied exactly",
  );
  return completionResponse(
    mutate(
      {
        title: "A model title that must be ignored",
        questions: task.slots.map((slot) =>
          groundedMode
            ? groundedQuestionForSlot(slot, task.focusExcerpt)
            : questionForSlot(slot, automaticMode),
        ),
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

function interruptedBeforeQuestionCompletes(value) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const splitIndex = Math.max(
    1,
    source.indexOf('"question"') + '"question":"partial'.length,
  );
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

test("v5.3 uses singleton primary calls and local answer mapping", async (context) => {
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
    Array(15).fill(1),
  );
  for (const request of requests) {
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    assert.equal(request.body.temperature, 0.2);
    assert.equal("reasoning_effort" in request.body, false);
    assert.equal("top_p" in request.body, false);
    assert.equal(request.body.max_tokens, 4_096);
    assert.match(
      request.body.messages[0].content,
      /one correctAnswer and exactly three unique distractors/,
    );
    assert.doesNotMatch(request.task, /"answerIndex"/);
  }
  assert.equal(result.protocolVersion, 7);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.3");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.2");
  assert.equal(result.importVersion, "extension-progressive-import-v5");
  assert.equal(result.generationProfile, "stable_auto_recovery_v5_3");
  assert.equal(result.quiz.title, "Trusted source lesson title");
  assert.equal(result.metrics.aiCalls, requests.length);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(calls.length, requests.length);
  assert.ok(calls.every((event) => event.classification === "primary"));
  assert.ok(calls.every((event) => event.protocolVersion === 7));
  assert.ok(calls.every((event) => event.requestedCount === 1));
  assert.ok(calls.every((event) => event.ordinalAttempt === 1));
  assert.ok(calls.every((event) => event.retryKind === undefined));
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answerIndex >= 0 &&
        question.answer === question.choices[question.answerIndex],
    ),
  );
});

test("v5.6 streams concept-only grounded singleton calls with protocol 8 telemetry", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.protocolVersion, 8);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.6");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.5");
  assert.equal(result.importVersion, "extension-progressive-import-v6");
  assert.equal(result.generationProfile, "evidence_grounded_auto_v5_4");
  assert.equal(calls.length, 5);
  assert.ok(
    calls.every(
      (event) => event.protocolVersion === 8 && event.purpose === "generation",
    ),
  );
  assert.ok(
    result.quiz.questions.every(
      (question) => question.claimKey && question.conceptCluster,
    ),
  );
});

test("v5.5 validates grounded true-false and short-answer singletons", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    groundedInput(5, ["true_false", "short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions
      .filter((question) => question.type === "true_false")
      .every(
        (question) =>
          question.answer === true &&
          question.correction === "The statement is accurate as written.",
      ),
  );
  assert.ok(
    result.quiz.questions
      .filter((question) => question.type === "short_answer")
      .every((question) => question.answer.includes("supported value")),
  );
});

test("v5.5 grants content repair budgets independently to each ordinal", async (context) => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map();
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    const ordinal = task.slots[0].ordinal;
    const attempt = (attempts.get(ordinal) ?? 0) + 1;
    attempts.set(ordinal, attempt);
    return responseForRequest(init.body, (value) => {
      if ((ordinal === 1 && attempt <= 2) || (ordinal === 2 && attempt === 1)) {
        value.questions[0].distractors[0].text =
          value.questions[0].correctAnswer;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(attempts.get(1), 3);
  assert.equal(attempts.get(2), 2);
  assert.equal(
    calls.filter((event) => event.classification === "automatic_retry").length,
    3,
  );
  assert.deepEqual(
    calls
      .filter((event) => event.classification === "automatic_retry")
      .map((event) => event.retryKind),
    ["answer_repair", "answer_repair", "answer_repair"],
  );
});

test("v5.6 rejects raw lesson framing and repairs only that singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let q1Attempts = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value, task) => {
      if (task.slots[0].ordinal === 1 && ++q1Attempts === 1) {
        value.questions[0].question =
          "According to the lesson, what exact supported value is reported for instructional claim 1?";
        value.questions[0].explanation =
          "According to the lesson, the source evidence explicitly states the supported value.";
      }
      return value;
    });

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.metrics.aiCalls, calls.length);
  assert.equal(
    result.metrics.retryCount,
    calls.filter((event) => event.classification === "automatic_retry").length,
  );
  assert.doesNotMatch(result.quiz.questions[0].question, /according to/iu);
  assert.equal(
    result.quiz.questions[0].question,
    "What exact supported value is reported for instructional claim 1?",
  );
  assert.equal(calls[0]?.outcome, "schema_invalid");
  assert.equal(calls[1]?.classification, "automatic_retry");
  assert.equal(calls[1]?.retryKind, "content_repair");
  assert.equal(calls[0]?.startIndex, 0);
  assert.equal(calls[1]?.startIndex, 0);
});

test("v5.5 automatically repairs a grounded course-trivia question before storage", async (context) => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map();
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    const ordinal = task.slots[0].ordinal;
    const attempt = (attempts.get(ordinal) ?? 0) + 1;
    attempts.set(ordinal, attempt);
    return responseForRequest(init.body, (value) => {
      if (ordinal === 1 && attempt === 1) {
        value.questions[0].concept = "AP Calculus BC exam weighting";
        value.questions[0].question =
          "What percentage of the AP Calculus BC exam is Unit 1 worth?";
        value.questions[0].claim = {
          subject: "Unit 1",
          relation: "is worth",
          value: "10 percent of the AP Calculus BC exam",
          cluster: "AP exam weighting",
        };
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(attempts.get(1), 2);
  assert.equal(
    result.metrics.retryCount,
    calls.filter((event) => event.classification === "automatic_retry").length,
  );
  assert.equal(calls[0]?.outcome, "schema_invalid");
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        !/exam|weight|percentage|unit 1 worth/iu.test(question.question),
    ),
  );
  const retry = calls.find(
    (event) => event.classification === "automatic_retry",
  );
  assert.equal(retry?.retryKind, "content_repair");
  assert.equal(retry?.startIndex, 0);
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
    const value = {
      questions: task.slots.map((slot) =>
        groundedQuestionForSlot(slot, task.focusExcerpt),
      ),
    };
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
    groundedInput(5),
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

test("one-character SSE supports singleton MC, true/false, and short-answer calls", async (context) => {
  const originalFetch = globalThis.fetch;
  const observedTypes = new Set();
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    assert.equal(task.slots.length, 1);
    observedTypes.add(task.slots[0].type);
    return oneCharacterSseResponse({
      questions: task.slots.map(questionForSlot),
    }).response;
  };

  await generateQuizFromPlainText(stableInput(), "sk-local-test");
  assert.deepEqual([...observedTypes].sort(), [
    "multiple_choice",
    "short_answer",
    "true_false",
  ]);
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
          const choices = [question.correctAnswer, ...question.distractors];
          const { correctAnswer, distractors, ...common } = question;
          return {
            ...common,
            concept: `  ${question.concept}  `,
            choices,
            answerIndex: "0",
            answer: correctAnswer.toUpperCase(),
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

test("formula token structures are serialized locally into canonical stored answers", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const canonical = "(u'(x)*v(x)-u(x)*v'(x))/(v(x)^2)";
  const prompts = [
    "Which quotient-rule derivative formula is supported by the lesson?",
    "How does the lesson express the derivative of a ratio of functions?",
    "Write the formula used to differentiate a numerator divided by a denominator.",
    "What symbolic expression combines u, v, and their derivatives for a quotient?",
    "State the lesson's denominator-squared differentiation equation.",
  ];
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value, task) => {
      const ordinal = task.slots[0].ordinal;
      value.questions[0] = {
        ...value.questions[0],
        question: prompts[ordinal - 1],
        answer: "(u'(x)*v(x)-u(x)*v'(x))/(v(x)²)",
        formulaTokens: formulaTokens(canonical),
        acceptableAnswers: [],
      };
      return value;
    });

  const result = await generateQuizFromPlainText(
    stableInput(5, ["short_answer"]),
    "sk-local-test",
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answer === canonical && !("formulaTokens" in question),
    ),
  );
  assert.equal(serializeFormulaTokens(formulaTokens(canonical)), canonical);
  assert.equal(
    serializeFormulaTokens(formulaTokens("u(x)/v(x)")),
    null,
    "division operands must be explicitly parenthesized",
  );
});

test("a formula question without a valid token structure uses only bounded automatic repairs", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      value.questions[0].question =
        "What derivative formula is supported by the lesson?";
      value.questions[0].answer = "(f(b)-f(a))/(b-a)";
      delete value.questions[0].formulaTokens;
      return value;
    });
  };

  await assert.rejects(
    generateQuizFromPlainText(
      stableInput(5, ["short_answer"]),
      "sk-local-test",
      () => undefined,
      undefined,
      () => undefined,
      (event) => events.push(event),
    ),
    (error) => error?.reasonCode === "schema_invalid",
  );
  assert.equal(fetchCount, 3);
  assert.deepEqual(
    events.map((event) => event.classification),
    ["primary", "automatic_retry", "automatic_retry"],
  );
  assert.deepEqual(
    events.slice(1).map((event) => event.retryKind),
    ["content_repair", "content_repair"],
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
    name: "ambiguous choices",
    expected: "answer_mapping_invalid",
    retryKind: "answer_repair",
    input: stableInput(5, ["multiple_choice"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        value.questions[0].distractors[0] = value.questions[0].correctAnswer;
        return value;
      }),
  },
  {
    name: "missing rubric",
    expected: "schema_invalid",
    retryKind: "content_repair",
    input: stableInput(5, ["short_answer"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        delete value.questions[0].rubricIdeas;
        return value;
      }),
  },
]) {
  if (!failure.retryKind) {
    failure.retryKind =
      failure.expected === "empty_content"
        ? "empty_content"
        : "truncated_output";
  }
  test(`${failure.name} exhausts exactly two bounded content repairs`, async (context) => {
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
    assert.equal(fetchCount, 3);
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((event) => event.classification),
      ["primary", "automatic_retry", "automatic_retry"],
    );
    assert.deepEqual(
      events.map((event) => event.outcome),
      [failure.expected, failure.expected, failure.expected],
    );
    assert.equal(events[1].retryKind, failure.retryKind);
    assert.equal(events[2].retryKind, failure.retryKind);
    assert.equal(events[2].retryDelayMs, 0);
  });
}

test("a wrong model id is assigned locally without another DeepSeek request", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      value.questions[0].id = "q15";
      return value;
    });
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(fetchCount, 5);
  assert.deepEqual(
    result.quiz.questions.map((question) => question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.ok(events.every((event) => event.classification === "primary"));
});

test("duplicate content repairs only the first missing singleton", async (context) => {
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
      if (fetchCount === 2) {
        value.questions[0].question =
          "Which specific photosynthesis result is supported for case 1?";
      }
      return value;
    });
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );
  assert.equal(fetchCount, 6, "five singleton primaries plus one q2 repair");
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(events[1].outcome, "duplicate_question");
  assert.equal(events[1].acceptedCount, 0);
  assert.equal(events[2].classification, "automatic_retry");
  assert.equal(events[2].retryKind, "duplicate_repair");
  assert.equal(events[2].startIndex, 1);
});

test("a confirmed transient failure retries only the missing singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  const progress = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response("", {
        status: 429,
        headers: { "retry-after": "0.8" },
      });
    }
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    (stage, value, detail) => progress.push({ stage, value, detail }),
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.equal(fetchCount, 6);
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.classification),
    ["primary", "automatic_retry"],
  );
  assert.ok(events[0].retryDelayMs >= 800);
  assert.ok(events[0].retryDelayMs <= 938);
  assert.equal(events[1].retryDelayMs, 0);
  assert.equal(events[1].retryKind, "transport");
  assert.ok(
    progress.some(
      (event) =>
        event.detail.status === "retrying" &&
        event.detail.attempt === 2 &&
        event.detail.maxAttempts === 5 &&
        event.detail.retryDelayMs >= 800,
    ),
  );
});

for (const failure of [
  { status: 401, reasonCode: "credential_required" },
  { status: 402, reasonCode: "billing_required" },
]) {
  test(`${failure.status} enters action-required handling with no blind model retry`, async (context) => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    const events = [];
    context.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response("", { status: failure.status });
    };

    await assert.rejects(
      generateQuizFromPlainText(
        stableInput(5, ["multiple_choice"]),
        "sk-local-test",
        () => undefined,
        undefined,
        () => undefined,
        (event) => events.push(event),
      ),
      (error) => error?.reasonCode === failure.reasonCode,
    );
    assert.equal(fetchCount, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].classification, "primary");
    assert.equal(events[0].outcome, failure.reasonCode);
    assert.equal(events[0].retryDelayMs, 0);
  });
}

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
    [[1], [2], [3], [4], [5]],
  );
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.equal(events[0].outcome, "complete");
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
    if (requests.length === 2) return interruptedBeforeQuestionCompletes(value);
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
    [[1], [2], [2], [3], [4], [5]],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(events.length, requests.length);
  assert.equal(events[1].acceptedCount, 0);
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

test("v5.1 continuation uses singleton automatic recovery on original metadata", async (context) => {
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
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.ok(events.every((event) => event.protocolVersion === 5));
  assert.ok(events.every((event) => event.purpose === "automatic_recovery"));
  assert.ok(events.every((event) => event.requestedCount === 1));
  assert.ok(events.every((event) => event.recoverySessionId === IDS.recovery));
});

test("Run 8 recovery preserves q1-q11 and classifies only attempted q12-q13 as retries", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const chunks = [];
  const types = Array.from(
    { length: 15 },
    (_, index) => ["multiple_choice", "true_false", "short_answer"][index % 3],
  );
  const acceptedQuestions = types.slice(0, 11).map((type, index) => ({
    id: `q${index + 1}`,
    type,
    concept: `Immutable accepted concept ${index + 1}`,
    question: `How does immutable concept ${index + 1} work?`,
  }));
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    {
      ...stableInput(15),
      generationProfile: "legacy_reasoning_v5_1",
      continuation: {
        startIndex: 11,
        resultProtocolVersion: 5,
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
        generationProfile: "legacy_reasoning_v5_1",
        nextCallIndex: 7,
        nextOrdinalAttempt: 2,
        retryOrdinals: [12, 13],
        previousOutcome: "schema_invalid",
        automaticRetryCount: 0,
        retryBudgetUsedCount: 1,
        acceptedQuestions,
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );

  assert.equal(result.generatedStartIndex, 11);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q12", "q13", "q14", "q15"],
  );
  assert.deepEqual(
    events.map((event) => event.classification),
    ["automatic_retry", "automatic_retry", "primary", "primary"],
  );
  assert.deepEqual(
    events.map((event) => event.callIndex),
    [7, 8, 9, 10],
  );
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.retryKind),
    ["content_repair", "content_repair"],
  );
  assert.ok(events.every((event) => event.protocolVersion === 5));
  assert.ok(events.every((event) => event.purpose === "automatic_recovery"));
  assert.ok(
    acceptedQuestions.every(
      (question, index) => question.id === `q${index + 1}`,
    ),
  );
});

test("v5.3 recovery resumes the first server-missing singleton without a manual call", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const seed = "a".repeat(64);
  const types = buildQuestionTypePlanFromSeed(["multiple_choice"], 5, seed);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    return responseForRequest(init.body);
  };

  const result = await generateQuizFromPlainText(
    {
      ...stableInput(5, ["multiple_choice"]),
      continuation: {
        startIndex: 1,
        resultProtocolVersion: 7,
        promptVersion: "quiz-local-json-stream-v5.3",
        validatorVersion: "validator-local-progressive-v4.2",
        generationProfile: "stable_auto_recovery_v5_3",
        questionPlan: { seed, types },
        nextCallIndex: 1,
        nextOrdinalAttempt: 1,
        automaticRetryCount: 0,
        acceptedQuestions: [
          {
            id: "q1",
            type: "multiple_choice",
            concept: "Stored first concept",
            question: "Which first result did the lesson support?",
          },
        ],
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );

  assert.equal(result.protocolVersion, 7);
  assert.equal(result.generatedStartIndex, 1);
  assert.deepEqual(
    requests.map((request) => request.slots[0].ordinal),
    [2, 3, 4, 5],
  );
  assert.deepEqual(
    events.map((event) => event.callIndex),
    [1, 2, 3, 4],
  );
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.ok(events.every((event) => event.recoverySessionId === IDS.recovery));
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
