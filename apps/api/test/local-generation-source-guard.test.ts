import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(import.meta.dirname, "../src");

describe("extension generation source guard", () => {
  it("contains no backend quiz-generation implementation", () => {
    const index = readFileSync(resolve(apiRoot, "index.ts"), "utf8");
    const routes = readFileSync(
      resolve(apiRoot, "routes/transcripts.ts"),
      "utf8",
    );
    const generationDirectory = resolve(apiRoot, "generation");
    expect(
      existsSync(generationDirectory) ? readdirSync(generationDirectory) : [],
    ).toEqual([]);
    expect(index).not.toContain("QuizGenerationWorkflow");
    expect(routes).not.toContain("waitUntil");
    expect(routes).not.toContain("QUIZ_GENERATION_WORKFLOW");
    expect(routes).not.toContain("chat/completions");
    expect(routes).not.toContain("validateLocalQuizSubmission");
  });
});
