import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalCheatSheet } from "../index.js";

const context = {
  title: "Context title must not be copied",
  source: "youtube",
  primer: "Context primer must not be copied",
  questions: [
    {
      prompt: "What is the mechanism?",
      explanation: "The mechanism moves charge through the circuit.",
    },
  ],
};

test("cheat sheets keep AI-generated title, source, and summary", async () => {
  const result = await generateLocalCheatSheet(
    context,
    "sk-test-key",
    undefined,
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "AI title",
                    source: "AI source",
                    summary: "AI summary",
                    keyConcepts: ["AI concept"],
                    definitions: [
                      { term: "Charge", definition: "AI definition" },
                    ],
                    formulas: [],
                    rememberThis: ["AI memory"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    },
  );

  assert.deepEqual(result, {
    title: "AI title",
    source: "AI source",
    summary: "AI summary",
    keyConcepts: ["AI concept"],
    definitions: [{ term: "Charge", definition: "AI definition" }],
    formulas: [],
    rememberThis: ["AI memory"],
  });
});

test("cheat sheets reject missing AI fields instead of using context fallbacks", async () => {
  await assert.rejects(
    generateLocalCheatSheet(context, "sk-test-key", undefined, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "AI summary only",
                    keyConcepts: [],
                    definitions: [],
                    formulas: [],
                    rememberThis: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    }),
    /AI-generated title, source, and summary are required/,
  );
});

test("cheat sheets reject metaphorical mechanism wording instead of storing it", async () => {
  await assert.rejects(
    generateLocalCheatSheet(context, "sk-test-key", undefined, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "AI title",
                    source: "AI source",
                    summary:
                      "Regional anesthetics create a chemical barricade.",
                    keyConcepts: [],
                    definitions: [],
                    formulas: [],
                    rememberThis: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    }),
    /metaphorical mechanism wording/,
  );
});
