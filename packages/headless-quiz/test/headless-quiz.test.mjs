import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessReporter } from "../src/reporter.js";
import { runHeadlessQuiz } from "../src/run-quiz.js";

function sourceFixture() {
  const statements = Array.from({ length: 24 }, (_, index) => {
    const ordinal = index + 1;
    return {
      id: `s${ordinal}`,
      startMs: index * 5_000,
      endMs: (index + 1) * 5_000,
      text: `Catalyst ${ordinal} transfers energy through pathway${ordinal} during objective${ordinal} because the reaction changes by ${ordinal + 10} units under the defined condition.`,
    };
  });
  return {
    videoId: "JoscDcbAjbY",
    title: "Electricity",
    language: "en",
    durationSeconds: 120,
    segments: statements,
    sourceSegmentCount: statements.length,
    characterCount: statements.reduce(
      (total, segment) => total + segment.text.length,
      0,
    ),
    transcriptFingerprint: "1234abcd",
    acquisition: "youtube_text_provider",
  };
}

function promptTask(body) {
  const task = body.messages.at(-1).content;
  const slot = task.match(
    /Create q(\d+) of (\d+)\. Required type: (multiple_choice|true_false|short_answer)\./u,
  );
  assert.ok(slot);
  const primaryClaim = task.match(
    /Assigned assessment fact[^:]*:\n([\s\S]*?)\n\nAdditional private context/u,
  )?.[1];
  assert.ok(primaryClaim);
  return {
    task,
    ordinal: Number(slot[1]),
    type: slot[3],
    polarity:
      /Required truth value, assigned locally by ClipQuest: true\./u.test(task),
    shortAnswerMode: task.match(
      /gradingMode=(atomic_term|proposition|enumeration|formula)/u,
    )?.[1],
    primaryClaim,
  };
}

function successfulModelResponse(init) {
  const task = promptTask(JSON.parse(init.body));
  const retryQuestion =
    task.type === "true_false"
      ? task.polarity
        ? `Energy moves through pathway${task.ordinal}.`
        : `Pathway${task.ordinal} prevents energy movement.`
      : `Which response explains pathway${task.ordinal}?`;
  const common = {
    type: task.type,
    concept: `energy pathway ${task.ordinal}`,
    retryQuestion,
    explanation: `Pathway${task.ordinal} transfers energy under its defined condition.`,
  };
  let question;
  if (task.type === "multiple_choice") {
    question = {
      ...common,
      question: `How does pathway${task.ordinal} affect energy transfer?`,
      correctAnswer: `It transfers energy under condition ${task.ordinal}`,
      distractors: [
        `It removes condition ${task.ordinal}`,
        `It blocks every reaction ${task.ordinal}`,
        `It eliminates energy ${task.ordinal}`,
      ],
    };
  } else if (task.type === "true_false") {
    const supportedStatement = task.primaryClaim.replace(
      /\s+because[\s\S]*$/u,
      ".",
    );
    question = task.polarity
      ? {
          ...common,
          supportedStatement,
        }
      : {
          ...common,
          supportedStatement,
          falseStatement: supportedStatement.replace("transfers", "blocks"),
        };
  } else if (task.shortAnswerMode === "formula") {
    question = {
      ...common,
      question: `What equation represents pathway${task.ordinal}?`,
      answer: "E=P*t",
      gradingMode: "formula",
      acceptableAnswers: [],
      requiredItems: [],
      formulaTokens: [
        { kind: "identifier", value: "E" },
        { kind: "operator", value: "=" },
        { kind: "identifier", value: "P" },
        { kind: "operator", value: "*" },
        { kind: "identifier", value: "t" },
      ],
    };
  } else if (task.shortAnswerMode === "enumeration") {
    question = {
      ...common,
      question: `Which two parts define pathway${task.ordinal}?`,
      answer: `energy transfer and condition ${task.ordinal}`,
      gradingMode: "enumeration",
      acceptableAnswers: [],
      requiredItems: ["energy transfer", `condition ${task.ordinal}`],
    };
  } else if (task.shortAnswerMode === "proposition") {
    question = {
      ...common,
      question: `How does pathway${task.ordinal} transfer energy?`,
      answer: `It transfers energy under condition ${task.ordinal}.`,
      gradingMode: "proposition",
      acceptableAnswers: [],
      requiredItems: ["transfers energy", `condition ${task.ordinal}`],
    };
  } else {
    question = {
      ...common,
      question: `What term identifies energy route ${task.ordinal}?`,
      answer: `pathway${task.ordinal}`,
      gradingMode: "atomic_term",
      acceptableAnswers: [],
      requiredItems: [],
    };
  }
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ questions: [question] }) },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function successfulGradeResponse() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content:
              "The response communicates the central answer expected by the question.",
            tool_calls: [
              {
                id: "grade-1",
                type: "function",
                function: {
                  name: "grade_answer",
                  arguments: JSON.stringify({
                    is_correct: true,
                    confidence: "high",
                    matched_ideas: ["central answer"],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("rejects unsupported counts before contacting the model", async () => {
  await assert.rejects(
    runHeadlessQuiz({
      url: "https://youtu.be/JoscDcbAjbY",
      apiKey: "test-key",
      questionCount: 4,
      source: sourceFixture(),
      reporter: createHeadlessReporter({ output() {} }),
      async fetch() {
        throw new Error("fetch should not run");
      },
    }),
    /between 5 and 50/,
  );
});

test("fails closed without a local DeepSeek key", async () => {
  await assert.rejects(
    runHeadlessQuiz({
      url: "https://youtu.be/JoscDcbAjbY",
      questionCount: 5,
      source: sourceFixture(),
      reporter: createHeadlessReporter({ output() {} }),
    }),
    /CLIPQUEST_DEEPSEEK_API_KEY/,
  );
});

test("never writes credential values into reporter events", async () => {
  const reporter = createHeadlessReporter({ output() {} });
  await assert.rejects(
    runHeadlessQuiz({
      url: "https://youtu.be/JoscDcbAjbY",
      apiKey: "super-private-headless-key",
      questionCount: 5,
      source: sourceFixture(),
      reporter,
      async fetch() {
        return new Response("unauthorized", { status: 401 });
      },
    }),
    /rejected the configured API key/,
  );
  assert.doesNotMatch(
    `${reporter.lines.join("\n")}\n${JSON.stringify(reporter.events)}`,
    /super-private-headless-key/,
  );
});

test("generates a complete mixed bank with successful AI provenance and no user action", async () => {
  const reporter = createHeadlessReporter({ output() {} });
  const result = await runHeadlessQuiz({
    url: "https://youtu.be/JoscDcbAjbY",
    apiKey: "test-key",
    questionCount: 5,
    questionTypes: "all",
    source: sourceFixture(),
    reporter,
    async fetch(_url, init) {
      return successfulModelResponse(init);
    },
  });
  assert.equal(result.questions.length, 5);
  assert.equal(result.provenance.length, 5);
  assert.equal(
    reporter.events.find((event) => event.type === "BANK_COMPLETE")
      ?.userActionsRequired,
    0,
  );
  assert.ok(
    result.provenance.every((entry) => entry.questionFingerprint.length === 64),
  );
});

test("recovers from one injected network interruption without user input", async () => {
  const reporter = createHeadlessReporter({ output() {} });
  const result = await runHeadlessQuiz({
    url: "https://youtu.be/JoscDcbAjbY",
    apiKey: "test-key",
    questionCount: 5,
    questionTypes: "all",
    interruptAfter: 2,
    source: sourceFixture(),
    reporter,
    async fetch(_url, init) {
      return successfulModelResponse(init);
    },
  });
  assert.equal(result.questions.length, 5);
  assert.equal(
    reporter.events.filter((event) => event.type === "FAULT_INJECTED").length,
    1,
  );
  assert.ok(
    reporter.events.some(
      (event) =>
        event.type === "AI_CALL_COMPLETED" &&
        event.outcome === "network_interrupted",
    ),
  );
  assert.equal(
    reporter.events.find((event) => event.type === "BANK_COMPLETE")
      ?.userActionsRequired,
    0,
  );
});

test("grades every generated question through the reason-first tool-call path", async () => {
  const reporter = createHeadlessReporter({ output() {} });
  const result = await runHeadlessQuiz({
    url: "https://youtu.be/JoscDcbAjbY",
    apiKey: "test-key",
    questionCount: 5,
    questionTypes: "all",
    answerAndGrade: true,
    source: sourceFixture(),
    reporter,
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      return Array.isArray(body.tools)
        ? successfulGradeResponse()
        : successfulModelResponse(init);
    },
  });
  assert.equal(result.grades.length, 5);
  assert.ok(result.grades.every((entry) => entry.grade.correct));
  assert.ok(
    result.grades.every(
      (entry) =>
        entry.grade.source === "deepseek_local" &&
        entry.grade.reason.length > 0,
    ),
  );
});
