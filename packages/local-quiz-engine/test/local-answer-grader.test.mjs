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
  assert.match(
    body.messages[0].content,
    /central relationship correctly and gives at least one relevant supporting fact/,
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
  let calls = 0;
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
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response(
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
            );
          }
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "" } }] }),
            { status: 200 },
          );
        },
      },
    ),
    /AI-generated reason/,
  );
});

test("local answer grading asks DeepSeek for a reason when the tool turn is blank", async () => {
  let calls = 0;
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
        calls += 1;
        const body = JSON.parse(init.body);
        if (calls === 1) {
          return new Response(
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
            { status: 200 },
          );
        }
        assert.equal(body.tools, undefined);
        assert.match(body.messages[0].content, /answer-feedback writer/);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "It explains that the circuit gives charge a complete path to move.",
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.correct, true);
  assert.match(result.reason, /complete path/);
});
