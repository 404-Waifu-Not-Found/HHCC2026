import test from "node:test";
import assert from "node:assert/strict";
import { gradeLocalAnswerWithDeepSeek } from "../index.js";

test("local answer grading sends question and response to a required tool call", async () => {
  let body;
  const result = await gradeLocalAnswerWithDeepSeek(
    {
      question: "Why does a battery need a complete external circuit?",
      response: "It lets charge move through the circuit.",
      questionType: "short_answer",
    },
    "sk-test-key",
    undefined,
    {
      fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Your response identifies the key mechanism.",
                  tool_calls: [
                    {
                      function: {
                        name: "grade_answer",
                        arguments: JSON.stringify({
                          is_correct: true,
                          confidence: "medium",
                          matched_ideas: [
                            "charge can move through the circuit",
                          ],
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
      },
    },
  );

  assert.equal(body.tool_choice.function.name, "grade_answer");
  assert.match(
    body.messages[1].content,
    /battery need a complete external circuit/,
  );
  assert.match(
    body.messages[1].content,
    /lets charge move through the circuit/,
  );
  assert.equal(result.correct, true);
  assert.equal(result.reason, "Your response identifies the key mechanism.");
  assert.equal(result.source, "deepseek_local");
});

test("local answer grading rejects a response without a valid tool decision", async () => {
  await assert.rejects(
    gradeLocalAnswerWithDeepSeek(
      {
        question: "Is water wet?",
        response: "Yes",
        questionType: "true_false",
      },
      "sk-test-key",
      undefined,
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Reason first." } }],
            }),
            { status: 200 },
          ),
      },
    ),
    /valid answer grading tool call/,
  );
});

test("local answer grading rejects a tool decision without an AI reason", async () => {
  await assert.rejects(
    gradeLocalAnswerWithDeepSeek(
      {
        question: "Is water wet?",
        response: "Yes",
        questionType: "true_false",
      },
      "sk-test-key",
      undefined,
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        function: {
                          name: "grade_answer",
                          arguments: JSON.stringify({
                            is_correct: true,
                            confidence: "high",
                            matched_ideas: ["water is wet"],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      },
    ),
    /AI-generated reason/,
  );
});
