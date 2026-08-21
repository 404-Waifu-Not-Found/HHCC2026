import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("quiz answer presentation", () => {
  async function quizSource() {
    return readFile(resolve(appRoot, "app/quiz/[attemptId].tsx"), "utf8");
  }

  it("does not imply that true is correct and false is incorrect before grading", async () => {
    const source = await quizSource();
    const trueFalseBranch = source.slice(
      source.indexOf('if (question.type === "true_false")'),
      source.indexOf('if (question.type === "ordering")'),
    );

    expect(trueFalseBranch).not.toContain('name="correct"');
    expect(trueFalseBranch).not.toContain('name="error"');
    expect(trueFalseBranch).not.toContain("leading=");
  });

  it("sends the completion action to the Library route named by its label", async () => {
    const source = await quizSource();
    const completionBranch = source.slice(
      source.indexOf("if (showCompletion && score !== undefined)"),
      source.indexOf("if (error && !question)"),
    );

    expect(completionBranch).toContain('router.replace("/(tabs)/library")');
    expect(completionBranch).not.toContain('router.replace("/(tabs)")');
  });
});
