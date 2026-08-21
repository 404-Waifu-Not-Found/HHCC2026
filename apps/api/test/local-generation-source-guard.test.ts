import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(import.meta.dirname, "../src");

describe("extension generation source guard", () => {
  it("contains no backend quiz-generation implementation", () => {
    const index = readFileSync(resolve(apiRoot, "index.ts"), "utf8");
    const adminRoute = readFileSync(
      resolve(apiRoot, "routes/admin.ts"),
      "utf8",
    );
    const quizRoute = readFileSync(
      resolve(apiRoot, "routes/quizzes.ts"),
      "utf8",
    );
    const quizImportRoute = readFileSync(
      resolve(apiRoot, "routes/quiz-imports.ts"),
      "utf8",
    );
    const generationDirectory = resolve(apiRoot, "generation");
    expect(
      existsSync(generationDirectory) ? readdirSync(generationDirectory) : [],
    ).toEqual([]);
    expect(index).not.toContain("QuizGenerationWorkflow");
    expect(index).not.toContain('app.route("/api/generation"');
    expect(index).not.toContain('app.route("/api/transcripts"');
    expect(adminRoute).not.toContain("generation_jobs");
    expect(quizRoute).not.toContain("generation_jobs");
    expect(quizImportRoute).not.toContain("chat/completions");
    expect(quizImportRoute).not.toContain("PRIVATE_BUCKET");
    expect(quizImportRoute).not.toContain("generation_jobs");
    expect(quizImportRoute).not.toContain("segments:");
    expect(quizImportRoute).not.toContain("reasoning_content");
  });
});
