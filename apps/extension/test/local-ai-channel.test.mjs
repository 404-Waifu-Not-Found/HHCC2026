import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateQuizFromPlainText } from "../src/local-generator.js";

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
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);

function quiz(questionCount = 5) {
  return {
    title: "Concept quiz",
    questions: Array.from({ length: questionCount }, (_, index) => ({
      id: `q${index + 1}`,
      concept: `Concept ${index + 1}`,
      question: `How does concept ${index + 1} apply in this complete scenario?`,
      choices: [
        `Supported answer ${index + 1}`,
        `Distractor A ${index + 1}`,
        `Distractor B ${index + 1}`,
        `Distractor C ${index + 1}`,
      ],
      answerIndex: 0,
      answer: `Supported answer ${index + 1}`,
      explanation: `The lesson text supports answer ${index + 1}.`,
    })),
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

test("long local generation uses a heartbeat port", () => {
  assert.match(background, /chrome\.runtime\.onConnect\.addListener/);
  assert.match(bridge, /chrome\.runtime\.connect\(\{ name: LOCAL_AI_PORT \}\)/);
  assert.match(bridge, /setInterval\([\s\S]*type: "heartbeat"/);
  assert.match(
    popup,
    /chrome\.runtime\.connect\(\{ name: "clipquest-local-ai-v1" \}\)/,
  );
});

test("the popup exposes local quiz JSON and plain-text caption download", () => {
  assert.ok(manifest.permissions.includes("downloads"));
  assert.equal(manifest.version, "0.3.1");
  assert.match(popupHtml, /Generate quiz JSON/);
  assert.match(popupHtml, /Download \.txt/);
  assert.match(popup, /message\.response\.result\.quiz/);
  assert.match(background, /captionsToPlainText/);
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
  assert.deepEqual(result.quiz, quiz());
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
