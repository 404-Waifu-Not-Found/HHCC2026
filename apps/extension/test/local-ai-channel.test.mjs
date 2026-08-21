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

function toolResponse(value) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "submit_quiz",
                  arguments: JSON.stringify(value),
                },
              },
            ],
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
  assert.equal(manifest.version, "0.4.5");
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

test("one thinking-mode request exposes only the submit_quiz tool", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    requestBody = JSON.parse(init.body);
    return toolResponse(quiz());
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
  assert.equal(requestBody.tools[0].function.name, "submit_quiz");
  assert.equal("tool_choice" in requestBody, false);
  assert.equal("response_format" in requestBody, false);
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

test("invalid tool arguments fail instead of producing fallback questions", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const invalid = quiz();
  invalid.questions[0].answer = "Not one of the choices";
  globalThis.fetch = async () => toolResponse(invalid);
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
    /invalid answer/,
  );
  assert.doesNotMatch(
    generator,
    /fallbackQuizItem|question\.fallback|jsonrepair/,
  );
});

test("invalid complete output is retried locally before the website sees an error", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const progress = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    calls += 1;
    const value = quiz();
    if (calls === 1)
      value.questions[0].choices[1] = value.questions[0].choices[0];
    return toolResponse(value);
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
  );
  assert.equal(calls, 2);
  assert.equal(result.metrics.aiCalls, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.ok(progress.some((event) => event.detail?.status === "retrying"));
});
