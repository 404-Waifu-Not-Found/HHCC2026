import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  generateQuizFromPlainText,
  randomizeMultipleChoiceOptions,
} from "../src/local-generator.js";
import {
  CLIPQUEST_PAGE_ORIGINS,
  isClipQuestPageOrigin,
} from "../src/origin-policy.js";

const background = await readFile(
  new URL("../src/background.js", import.meta.url),
  "utf8",
);
const bridge = await readFile(
  new URL("../src/clipquest-bridge.js", import.meta.url),
  "utf8",
);
const generator = await readFile(
  new URL("../src/local-generator.js", import.meta.url),
  "utf8",
);
const popup = await readFile(
  new URL("../src/popup.js", import.meta.url),
  "utf8",
);
const popupHtml = await readFile(
  new URL("../src/popup.html", import.meta.url),
  "utf8",
);
const quickOpen = await readFile(
  new URL("../src/youtube-quick-open.js", import.meta.url),
  "utf8",
);
const quickOpenCss = await readFile(
  new URL("../src/youtube-quick-open.css", import.meta.url),
  "utf8",
);
const buildScript = await readFile(
  new URL("../scripts/build.mjs", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);

function quiz(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  let trueFalseIndex = 0;
  return {
    title: "Concept quiz",
    questions: Array.from({ length: questionCount }, (_, index) => {
      const type = questionTypes[index % questionTypes.length];
      const common = {
        id: `q${index + 1}`,
        type,
        concept: `Concept ${index + 1}`,
        question: `How does concept ${index + 1} apply in this complete scenario?`,
        explanation: `The lesson text supports answer ${index + 1}.`,
      };
      if (type === "multiple_choice") {
        return {
          ...common,
          choices: [
            `Supported answer ${index + 1}`,
            `Distractor A ${index + 1}`,
            `Distractor B ${index + 1}`,
            `Distractor C ${index + 1}`,
          ],
          answerIndex: 0,
          answer: `Supported answer ${index + 1}`,
        };
      }
      if (type === "true_false") {
        const answer = trueFalseIndex % 2 === 0;
        trueFalseIndex += 1;
        return {
          ...common,
          answer,
          correction: answer
            ? "The statement is accurate as written."
            : "The corrected statement is supported by the lesson.",
        };
      }
      return {
        ...common,
        answer: `Reference answer ${index + 1}`,
        rubricIdeas: [`Required idea ${index + 1}`],
        acceptableAnswers: [`Equivalent answer ${index + 1}`],
      };
    }),
  };
}

function jsonResponse(value) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(value),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 50 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function rawCompletionResponse(content, finishReason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          message: { content },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function byteFragmentedSseResponse(value) {
  const encoder = new TextEncoder();
  const content = JSON.stringify(value);
  const contentFrames = Array.from(
    content,
    (character) =>
      `data: ${JSON.stringify({
        choices: [
          {
            finish_reason: null,
            delta: { content: character },
          },
        ],
      })}\r\n\r\n`,
  ).join(": keep-alive\r\n\r\n");
  const finish = JSON.stringify({
    choices: [{ finish_reason: "stop", delta: {} }],
  });
  const usage = JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: 101,
      completion_tokens: 202,
      completion_tokens_details: { reasoning_tokens: 51 },
    },
  });
  const usageSplit = usage.indexOf(",") + 1;
  const bytes = encoder.encode(
    `: keep-alive\r\n\r\n${contentFrames}data: ${finish}\r\n\r\ndata: ${usage.slice(0, usageSplit)}\r\ndata: ${usage.slice(usageSplit)}\r\n\r\ndata: [DONE]\r\n\r\n`,
  );
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 31));
        offset += 31;
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function streamingJsonResponse(
  value,
  pauseAfterQuestions = 0,
  contentDeltaSize = 17,
) {
  const encoder = new TextEncoder();
  const argumentsText = JSON.stringify(value);
  let splitIndex = 0;
  if (pauseAfterQuestions > 0) {
    const questionText = JSON.stringify(
      value.questions[pauseAfterQuestions - 1],
    );
    splitIndex = argumentsText.indexOf(questionText) + questionText.length;
  }
  let release = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const event = (payload) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const enqueueContent = (controller, content) => {
    for (let offset = 0; offset < content.length; offset += contentDeltaSize) {
      controller.enqueue(
        event({
          choices: [
            {
              finish_reason: null,
              delta: {
                content: content.slice(offset, offset + contentDeltaSize),
              },
            },
          ],
        }),
      );
    }
  };
  const response = new Response(
    new ReadableStream({
      async start(controller) {
        enqueueContent(
          controller,
          argumentsText.slice(0, splitIndex || undefined),
        );
        if (splitIndex) await gate;
        if (splitIndex) {
          enqueueContent(controller, argumentsText.slice(splitIndex));
        }
        controller.enqueue(
          event({
            choices: [{ finish_reason: "stop", delta: {} }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              completion_tokens_details: { reasoning_tokens: 50 },
            },
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  return { response, release };
}

function interruptedStreamingJsonResponse(value, completedQuestions) {
  const encoder = new TextEncoder();
  const argumentsText = JSON.stringify(value);
  const questionText = JSON.stringify(value.questions[completedQuestions - 1]);
  const splitIndex = argumentsText.indexOf(questionText) + questionText.length;
  let reads = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (reads === 0) {
          reads += 1;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    finish_reason: null,
                    delta: {
                      content: argumentsText.slice(0, splitIndex),
                    },
                  },
                ],
              })}\n\n`,
            ),
          );
          return;
        }
        controller.error(new Error("The streamed connection was interrupted."));
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

test("long local generation uses a heartbeat port", () => {
  assert.match(background, /chrome\.runtime\.onConnect\.addListener/);
  assert.match(bridge, /chrome\.runtime\.connect\(\{ name: LOCAL_AI_PORT \}\)/);
  assert.match(bridge, /setInterval\([\s\S]*type: "heartbeat"/);
  assert.doesNotMatch(popup, /chrome\.runtime\.connect/);
});

test("website privileges are bound to exact ClipQuest origins", () => {
  assert.match(background, /isClipQuestPageOrigin/);
  assert.doesNotMatch(background, /url\.hostname === "localhost"/);
  assert.doesNotMatch(background, /url\.hostname === "127\.0\.0\.1"/);
  assert.equal(
    isClipQuestPageOrigin("https://clipquest.ccwu.cc/library"),
    true,
  );
  assert.equal(
    isClipQuestPageOrigin("http://localhost:8081/create/video"),
    true,
  );
  assert.equal(isClipQuestPageOrigin("http://127.0.0.1:8081/"), true);
  assert.equal(isClipQuestPageOrigin("http://localhost:19006/"), true);
  assert.equal(isClipQuestPageOrigin("http://127.0.0.1:19006/"), true);
  assert.equal(isClipQuestPageOrigin("http://localhost:3000/"), false);
  assert.equal(isClipQuestPageOrigin("http://127.0.0.1:8787/"), false);
  assert.equal(
    isClipQuestPageOrigin("https://clipquest.ccwu.cc.evil.test/"),
    false,
  );
  assert.deepEqual(
    [...CLIPQUEST_PAGE_ORIGINS],
    [
      "https://clipquest.ccwu.cc",
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "http://localhost:19006",
      "http://127.0.0.1:19006",
    ],
  );
});

test("DeepSeek key management is restricted to extension pages", () => {
  for (const messageType of ["get", "save", "delete", "test"]) {
    assert.match(
      background,
      new RegExp(
        `message\\?\\.type === "clipquest\\.key\\.${messageType}\\.v1"\\) \\{\\s+if \\(!extensionPageSender\\(sender\\)\\) return false;`,
      ),
    );
  }
});

test("release builds preserve the loaded unpacked extension directory", () => {
  assert.doesNotMatch(buildScript, /rmSync\(outputRoot/);
  assert.match(buildScript, /mkdtempSync/);
  assert.match(buildScript, /stableExtensionOutput/);
  assert.match(buildScript, /cpSync\(extensionOutput, stableExtensionOutput/);
  assert.match(bridge, /async function announce\(\) \{\s+try \{/);
});

test("the popup exposes only DeepSeek configuration", () => {
  assert.equal(manifest.version, "0.8.0");
  assert.match(popupHtml, /DeepSeek configuration/);
  assert.match(popupHtml, /DeepSeek API key/);
  assert.match(popupHtml, /Save &amp; test/);
  assert.match(popupHtml, /Remove key/);
  assert.match(popupHtml, /clipquest-lockup-on-light\.png/);
  assert.match(popupHtml, /clipquest-lockup-on-dark\.png/);
  assert.doesNotMatch(popupHtml, /Generate a concept quiz/);
  assert.doesNotMatch(popupHtml, /YouTube URL/);
  assert.doesNotMatch(popupHtml, /Generate quiz JSON/);
  assert.doesNotMatch(popupHtml, /Download \.txt/);
  assert.doesNotMatch(popup, /youtubeVideoId|quiz-output|download-text/);
  assert.match(background, /captionsToPlainText/);
});

test("caption acquisition never creates a visible fetch tab", () => {
  assert.ok(!manifest.permissions.includes("offscreen"));
  assert.doesNotMatch(background, /chrome\.tabs\.create/);
  assert.doesNotMatch(background, /chrome\.tabs\.remove/);
  assert.match(background, /matchingYouTubeTab/);
  assert.match(background, /chrome\.tabs\.query/);
  assert.match(
    background,
    /Keep this YouTube video open in a tab while ClipQuest prepares the quiz/,
  );
  assert.doesNotMatch(buildScript, /youtube-background-captions\.js/);
});

test("YouTube watch pages embed a quick ClipQuest handoff", () => {
  const youtubeScript = manifest.content_scripts.find((entry) =>
    entry.js?.includes("youtube-quick-open.js"),
  );
  assert.ok(youtubeScript);
  assert.ok(youtubeScript.css.includes("youtube-quick-open.css"));
  assert.ok(
    manifest.web_accessible_resources.some(
      (entry) =>
        entry.resources.includes("icons/icon-48.png") &&
        entry.matches.includes("https://www.youtube.com/*"),
    ),
  );
  assert.match(quickOpen, /clipquest-quick-open/);
  assert.match(quickOpen, /Open in ClipQuest/);
  assert.match(quickOpen, /https:\/\/clipquest\.ccwu\.cc/);
  assert.match(quickOpen, /new URL\("\/"/);
  assert.match(quickOpen, /searchParams\.set\(\s*"url"/);
  assert.match(quickOpen, /searchParams\.set\("autostart", "1"\)/);
  assert.match(quickOpen, /chrome\.runtime\.getURL\("icons\/icon-48\.png"\)/);
  assert.match(quickOpen, /ytd-watch-metadata #actions-inner/);
  assert.match(quickOpen, /#menu ytd-menu-renderer/);
  assert.match(quickOpen, /#flexible-item-buttons/);
  assert.match(quickOpen, /insertBefore\(link, placement\.before\)/);
  assert.match(quickOpen, /yt-navigate-finish/);
  assert.match(quickOpen, /yt-page-data-updated/);
  assert.match(quickOpen, /new MutationObserver/);
  assert.match(quickOpenCss, /prefers-reduced-motion: reduce/);
  assert.match(buildScript, /youtube-quick-open\.css/);
  assert.match(buildScript, /youtube-quick-open\.js/);
});

test("the YouTube handoff mounts between Share and flexible actions", () => {
  class FakeElement {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.ownTextContent = "";
    }

    get textContent() {
      return this.children.length
        ? this.children.map((child) => child.textContent).join("")
        : this.ownTextContent;
    }

    set textContent(value) {
      this.ownTextContent = value;
    }

    get nextElementSibling() {
      if (!this.parentElement) return null;
      const index = this.parentElement.children.indexOf(this);
      return this.parentElement.children[index + 1] ?? null;
    }

    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }

    insertBefore(child, before) {
      child.remove();
      child.parentElement = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
    }

    querySelector(selector) {
      if (selector === "#menu ytd-menu-renderer") return menu;
      if (selector === ":scope > #flexible-item-buttons") return flexible;
      if (selector === ":scope > #button-shape") return more;
      return null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, value);
    }

    remove() {
      if (!this.parentElement) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
  }

  const actions = new FakeElement("div", "actions-inner");
  const menu = new FakeElement("ytd-menu-renderer");
  const shareGroup = new FakeElement("div", "top-level-buttons-computed");
  const flexible = new FakeElement("div", "flexible-item-buttons");
  const more = new FakeElement("yt-button-shape", "button-shape");
  menu.append(shareGroup, flexible, more);

  const document = {
    addEventListener() {},
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    documentElement: new FakeElement("html"),
    getElementById(id) {
      return menu.children.find((child) => child.id === id) ?? null;
    },
    querySelector(selector) {
      return selector === "ytd-watch-metadata #actions-inner" ? actions : null;
    },
  };

  runInNewContext(quickOpen, {
    URL,
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://clipquest/${path}`,
      },
    },
    document,
    location: {
      href: "https://www.youtube.com/watch?v=SVb9OV0bLzI&list=playlist",
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    window: { addEventListener() {} },
  });

  assert.equal(menu.children[0], shareGroup);
  assert.equal(menu.children[1].id, "clipquest-quick-open");
  assert.equal(menu.children[2], flexible);
  assert.equal(menu.children[1].textContent, "Open in ClipQuest");
  assert.match(menu.children[1].href, /^https:\/\/clipquest\.ccwu\.cc\/?\?/);
  assert.match(menu.children[1].href, /url=https%3A%2F%2Fwww\.youtube\.com/);
  assert.match(menu.children[1].href, /autostart=1/);
});

test("choice order uses unbiased random shuffling and preserves every answer", () => {
  const original = quiz(15, ["multiple_choice"]);
  const randomized = randomizeMultipleChoiceOptions(
    original,
    seededRandom(0x1234abcd),
  );
  const rerandomized = randomizeMultipleChoiceOptions(
    original,
    seededRandom(0x89abcdef),
  );

  assert.notDeepEqual(
    randomized.questions.map((question) => question.choices),
    original.questions.map((question) => question.choices),
  );
  assert.notDeepEqual(
    rerandomized.questions.map((question) => question.choices),
    randomized.questions.map((question) => question.choices),
  );
  assert.deepEqual(original.questions[0].choices, [
    "Supported answer 1",
    "Distractor A 1",
    "Distractor B 1",
    "Distractor C 1",
  ]);

  const positionCounts = [0, 0, 0, 0];
  randomized.questions.forEach((question, index) => {
    assert.deepEqual(
      new Set(question.choices),
      new Set(original.questions[index].choices),
    );
    assert.equal(question.choices[question.answerIndex], question.answer);
    positionCounts[question.answerIndex] += 1;
  });
  assert.ok(Math.max(...positionCounts) - Math.min(...positionCounts) <= 1);
  assert.match(generator, /crypto\.getRandomValues/);
  assert.doesNotMatch(generator, /Math\.random/);
});

test("caption extraction returns an independently observed video duration", async () => {
  const pageBridge = await readFile(
    new URL("../src/youtube-page.js", import.meta.url),
    "utf8",
  );
  const contentScript = await readFile(
    new URL("../src/youtube-content.js", import.meta.url),
    "utf8",
  );
  assert.match(pageBridge, /response\?\.videoDetails\?\.lengthSeconds/);
  assert.match(pageBridge, /player\?\.getDuration\?\.\(\)/);
  assert.match(contentScript, /trustworthy video duration/);
  assert.match(contentScript, /durationSeconds/);
});

test("one thinking-mode request uses streamable JSON response content", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    requestBody = JSON.parse(init.body);
    return jsonResponse(quiz());
  };
  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      jobId: "11111111-1111-4111-8111-111111111111",
      transcriptFingerprint: "1234abcd",
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
  );
  assert.equal(calls, 1);
  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.deepEqual(requestBody.thinking, { type: "enabled" });
  assert.equal(requestBody.reasoning_effort, "high");
  assert.equal(requestBody.stream, true);
  assert.deepEqual(requestBody.stream_options, { include_usage: true });
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.equal("tools" in requestBody, false);
  assert.equal("tool_choice" in requestBody, false);
  assert.match(requestBody.messages[0].content, /exactly one JSON object/);
  assert.doesNotMatch(requestBody.messages[0].content, /submit_quiz/);
  assert.equal(result.metrics.aiCalls, 1);
  assert.equal(result.metrics.retryCount, 0);
  assert.deepEqual(
    result.quiz.questions.map((question) => question.type),
    [
      "multiple_choice",
      "true_false",
      "short_answer",
      "multiple_choice",
      "true_false",
    ],
  );
  const answerIndices = result.quiz.questions
    .filter((question) => question.type === "multiple_choice")
    .map((question) => question.answerIndex);
  assert.equal(new Set(answerIndices).size, answerIndices.length);
});

test("validated questions are published individually before the full quiz finishes", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(10);
  const chunks = [];
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    const startIndex = calls * 5;
    calls += 1;
    return jsonResponse({
      title: completeQuiz.title,
      questions: completeQuiz.questions.slice(startIndex, startIndex + 5),
    });
  };

  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 10,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      jobId: "11111111-1111-4111-8111-111111111111",
      transcriptFingerprint: "1234abcd",
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.equal(calls, 2);
  assert.equal(chunks.length, 10);
  assert.deepEqual(
    chunks.map((chunk) => ({
      startIndex: chunk.startIndex,
      count: 1,
      total: chunk.totalQuestions,
    })),
    Array.from({ length: 10 }, (_, index) => ({
      startIndex: index,
      count: 1,
      total: 10,
    })),
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    Array.from({ length: 10 }, (_, index) => `q${index + 1}`),
  );
  assert.equal(result.quiz.questions.length, 10);
  assert.equal(result.metrics.aiCalls, 2);
  assert.match(background, /type: "question"/);
  assert.match(bridge, /type: "generation-question"/);
  assert.match(bridge, /question-stream-v1/);
});

test("a 15-question quiz uses three globally ordered calls of at most five questions", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(15);
  const chunks = [];
  const requestBodies = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    requestBodies.push(request);
    const startIndex = (requestBodies.length - 1) * 5;
    return jsonResponse({
      title: completeQuiz.title,
      questions: completeQuiz.questions.slice(startIndex, startIndex + 5),
    });
  };

  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 15,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.equal(requestBodies.length, 3);
  assert.match(requestBodies[0].messages[0].content, /positions q1 through q5/);
  assert.match(
    requestBodies[1].messages[0].content,
    /positions q6 through q10/,
  );
  assert.match(
    requestBodies[2].messages[0].content,
    /positions q11 through q15/,
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.startIndex),
    Array.from({ length: 15 }, (_, index) => index),
  );
  assert.equal(result.quiz.questions.length, 15);
  assert.equal(result.metrics.aiCalls, 3);
});

test("tiny JSON content deltas publish question one before the chat response finishes", async (context) => {
  const originalFetch = globalThis.fetch;
  const streamedQuiz = quiz(5);
  streamedQuiz.title = 'A "questions": [{braced}] lesson';
  streamedQuiz.questions[0].question =
    'How does the literal {example} and the word "questions" apply?';
  const streamed = streamingJsonResponse(streamedQuiz, 1, 1);
  const chunks = [];
  let resolveFirstQuestion;
  const firstQuestion = new Promise((resolve) => {
    resolveFirstQuestion = resolve;
  });
  let generationSettled = false;
  context.after(() => {
    streamed.release();
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => streamed.response;

  const generation = generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => {
      chunks.push(chunk);
      if (chunk.startIndex === 0) resolveFirstQuestion();
    },
  ).finally(() => {
    generationSettled = true;
  });

  await firstQuestion;
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].question.id, "q1");
  assert.equal(generationSettled, false);

  streamed.release();
  const result = await generation;
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
});

test("CRLF SSE survives byte boundaries, keep-alives, multiline usage, and empty choices", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(5);
  completeQuiz.title = "流式概念测验";
  completeQuiz.questions[0].question =
    "学习者如何应用这个包含 {花括号} 的概念？";
  const chunks = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => byteFragmentedSseResponse(completeQuiz);

  const result = await generateQuizFromPlainText(
    {
      title: "可信的视频标题",
      quizLanguage: "zh-CN",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "这是一段完整的课程转写，包含足够多的重要概念用于生成可靠测验。".repeat(
          8,
        ),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.quiz.title, "流式概念测验");
  assert.equal(result.metrics.inputTokens, 101);
  assert.equal(result.metrics.outputTokens, 202);
  assert.equal(result.metrics.reasoningTokens, 51);
});

test("the first streamed question publishes before a later root title", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(5);
  const streamed = streamingJsonResponse(
    {
      questions: completeQuiz.questions,
      title: completeQuiz.title,
    },
    1,
  );
  const chunks = [];
  let resolveFirstQuestion;
  const firstQuestion = new Promise((resolve) => {
    resolveFirstQuestion = resolve;
  });
  let generationSettled = false;
  context.after(() => {
    streamed.release();
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => streamed.response;

  const generation = generateQuizFromPlainText(
    {
      title: "Trusted YouTube lesson title",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => {
      chunks.push(chunk);
      if (chunk.startIndex === 0) resolveFirstQuestion();
    },
  ).finally(() => {
    generationSettled = true;
  });

  await firstQuestion;
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].question.id, "q1");
  assert.equal(chunks[0].title, "Trusted YouTube lesson title");
  assert.equal(generationSettled, false);

  streamed.release();
  const result = await generation;
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
});

test("an interrupted stream retries only the unresolved question suffix", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(5);
  const chunks = [];
  const requestBodies = [];
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    calls += 1;
    if (calls === 1) {
      return interruptedStreamingJsonResponse(completeQuiz, 1);
    }
    return jsonResponse({
      title: completeQuiz.title,
      questions: completeQuiz.questions.slice(1),
    });
  };

  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.equal(calls, 2);
  assert.match(requestBodies[1].messages[0].content, /positions q2 through q5/);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.aiCalls, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(result.quiz.questions.length, 5);
});

test("empty, truncated, and malformed roots preserve accepted questions and continue at the suffix", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(5);
  const chunks = [];
  const requestBodies = [];
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    calls += 1;
    if (calls === 1) return rawCompletionResponse("");
    if (calls === 2) {
      return rawCompletionResponse(
        '{"title":"Cut off","questions":[',
        "length",
      );
    }
    if (calls === 3) {
      return jsonResponse({ ...completeQuiz, unexpectedRootField: true });
    }
    return jsonResponse({
      title: completeQuiz.title,
      questions: completeQuiz.questions.slice(4),
    });
  };

  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.equal(calls, 4);
  assert.match(requestBodies[3].messages[0].content, /positions q5 through q5/);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.aiCalls, 4);
  assert.equal(result.metrics.retryCount, 3);
});

test("credential, billing, and permission failures stop without blind retries", async (context) => {
  const originalFetch = globalThis.fetch;
  let status = 401;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ error: { message: `DeepSeek status ${status}` } }),
      { status, headers: { "content-type": "application/json" } },
    );
  };
  const input = {
    title: "Lesson",
    quizLanguage: "en",
    questionCount: 5,
    questionTypes: ["multiple_choice", "true_false", "short_answer"],
    plainText: "A complete lesson transcript about important concepts. ".repeat(
      8,
    ),
  };

  for (const [httpStatus, reasonCode] of [
    [401, "credential_invalid"],
    [402, "billing_required"],
    [403, "permission_denied"],
  ]) {
    status = httpStatus;
    let thrown;
    try {
      await generateQuizFromPlainText(
        input,
        "sk-test-key-for-local-generation",
      );
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown?.reasonCode, reasonCode);
  }
  assert.equal(calls, 3);
});

test("wrong answers, ids, types, and extra fields never reach the website", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    calls += 1;
    const invalid = quiz();
    if (calls === 1) {
      invalid.questions[0].answer = "Not one of the choices";
    } else if (calls === 2) {
      invalid.questions[0].id = "q9";
    } else if (calls === 3) {
      invalid.questions[0].type = "true_false";
    } else {
      invalid.questions[0].unexpected = "never accept this";
    }
    return jsonResponse(invalid);
  };
  await assert.rejects(
    generateQuizFromPlainText(
      {
        title: "Lesson",
        quizLanguage: "en",
        questionCount: 5,
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        plainText:
          "A complete lesson transcript about important concepts. ".repeat(8),
      },
      "sk-test-key-for-local-generation",
    ),
    /unexpected field/,
  );
  assert.equal(calls, 4, "the initial call gets exactly three retries");
  assert.doesNotMatch(
    generator,
    /fallbackQuizItem|question\.fallback|jsonrepair/,
  );
});

test("manual continuation starts at the authoritative first missing question", async (context) => {
  const originalFetch = globalThis.fetch;
  const completeQuiz = quiz(5);
  const chunks = [];
  let requestBody;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      title: completeQuiz.title,
      questions: completeQuiz.questions.slice(3),
    });
  };

  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
      continuation: {
        startIndex: 3,
        acceptedQuestions: completeQuiz.questions
          .slice(0, 3)
          .map((question) => ({
            id: question.id,
            type: question.type,
            concept: question.concept,
            question: question.question,
          })),
      },
    },
    "sk-test-key-for-local-generation",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
  );

  assert.match(requestBody.messages[0].content, /positions q4 through q5/);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q4", "q5"],
  );
  assert.equal(result.generatedStartIndex, 3);
  assert.equal(result.totalQuestions, 5);
});

test("duplicate prompts are rejected and the retry starts after accepted questions", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const progress = [];
  const chunks = [];
  const requestBodies = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    calls += 1;
    const value = quiz();
    if (calls === 1) {
      value.questions[1].question = value.questions[0].question;
      return jsonResponse(value);
    }
    return jsonResponse({
      title: value.title,
      questions: value.questions.slice(1),
    });
  };
  const result = await generateQuizFromPlainText(
    {
      title: "Lesson",
      quizLanguage: "en",
      questionCount: 5,
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
      plainText:
        "A complete lesson transcript about important concepts. ".repeat(8),
    },
    "sk-test-key-for-local-generation",
    (stage, value, detail) => progress.push({ stage, value, detail }),
    undefined,
    (chunk) => chunks.push(chunk),
  );
  assert.equal(calls, 2);
  assert.match(requestBodies[1].messages[0].content, /positions q2 through q5/);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.aiCalls, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.ok(progress.some((event) => event.detail?.status === "retrying"));
});
