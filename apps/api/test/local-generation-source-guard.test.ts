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
    const progressiveQuiz = readFileSync(
      resolve(apiRoot, "lib/progressive-quiz.ts"),
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
    expect(progressiveQuiz).not.toContain("chat/completions");
    expect(progressiveQuiz).not.toContain("fetch(");
  });

  it("stores validated questions and exposes background generation state", () => {
    const quizRoute = readFileSync(
      resolve(apiRoot, "routes/quizzes.ts"),
      "utf8",
    );
    const quizImportRoute = readFileSync(
      resolve(apiRoot, "routes/quiz-imports.ts"),
      "utf8",
    );

    expect(quizImportRoute).toContain('post("/progressive"');
    expect(quizImportRoute).toContain('put("/:quizId/questions"');
    expect(quizImportRoute).toContain('patch("/:quizId/progress"');
    expect(quizImportRoute).toContain("INSERT OR IGNORE INTO attempt_items");
    expect(quizRoute).toContain('get("/attempts/:attemptId/generation"');
    expect(quizRoute).toContain("readProgressiveGenerationSnapshot");
    expect(quizRoute).not.toContain("attemptGenerationAvailability");
    expect(quizRoute).toContain("progressiveSummary.plannedCount");
    expect(quizRoute).toContain("gradeShortAnswerWithAi");
    expect(quizRoute).toContain("learnerAnswer: answer");
    expect(quizRoute).not.toContain("requiredIdeas.join");
    expect(quizRoute).toContain("not synthesize one from rubric fragments");

    const answerRoute = quizRoute.slice(
      quizRoute.indexOf('post("/attempts/:attemptId/answer"'),
      quizRoute.indexOf('get("/attempts/:attemptId/resume"'),
    );
    expect(answerRoute.indexOf("attemptGenerationState")).toBeLessThan(
      answerRoute.indexOf("UPDATE attempts SET retry_pending"),
    );
    expect(answerRoute).toContain("if (!reservationCommitted)");
  });
});
