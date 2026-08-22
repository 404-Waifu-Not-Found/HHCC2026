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

  it("announces reason-first feedback as an assertive accessible detail", async () => {
    const source = await readFile(
      resolve(appRoot, "src/components/FeedbackPanel.tsx"),
      "utf8",
    );
    expect(source).toContain("accessible");
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('accessibilityLiveRegion="assertive"');
  });

  it("shows the correct answer only after an incorrect grade", async () => {
    const source = await quizSource();

    expect(source).toContain("!feedback.correct && correctAnswer");
    expect(source).toContain('translate("correctAnswer")');
    expect(source).toContain(
      "presentCorrectAnswer(question, feedback.correctAnswer",
    );
  });

  it("marks the correct option after an incorrect grade", async () => {
    const source = await quizSource();

    expect(source).toContain(
      'if (feedback && isCorrectChoice) return "correct"',
    );
    expect(source).toContain("displayToCanonical?.[index] ?? index");
    expect(source).toContain("feedback?.correctAnswer === true");
    expect(source).toContain("feedback?.correctAnswer === false");
  });

  it("sends the completion action to the Library route named by its label", async () => {
    const source = await quizSource();
    const completionBranch = source.slice(
      source.indexOf("if (showCompletion && score !== undefined)"),
      source.indexOf("if (waitingForQuestions)"),
    );

    expect(completionBranch).toContain('router.replace("/(tabs)/library")');
    expect(completionBranch).not.toContain('router.replace("/(tabs)")');
  });

  it("pins floating quiz status to synchronous web breakpoint gutters", async () => {
    const [screenSource, htmlSource] = await Promise.all([
      readFile(resolve(appRoot, "src/components/Screen.tsx"), "utf8"),
      readFile(resolve(appRoot, "app/+html.tsx"), "utf8"),
    ]);
    expect(screenSource).toContain('nativeID="clipquest-screen-floating"');
    expect(screenSource).toContain(
      'right: Platform.OS === "web" ? undefined : horizontal',
    );
    expect(htmlSource).toContain("#clipquest-screen-floating { right: 20px; }");
    expect(htmlSource).toContain("@media (min-width: 768px)");
    expect(htmlSource).toContain("right: 24px");
    expect(htmlSource).toContain("@media (min-width: 1024px)");
    expect(htmlSource).toContain("right: 32px");
  });

  it("keeps a zero-question completion total visible", async () => {
    const source = await quizSource();
    expect(source).toContain("{completedTotal !== undefined ? (");
    expect(source).not.toContain("{completedTotal ? (");
  });

  it("offers a choice after the next-question wait timeout", async () => {
    const source = await quizSource();
    const waitingBranch = source.slice(
      source.indexOf("if (waitingForQuestions)"),
      source.indexOf("if (error && !question)"),
    );

    expect(source).toContain("QUESTION_WAIT_TIMEOUT_MS");
    expect(waitingBranch).toContain('testID="quiz-stay-here"');
    expect(waitingBranch).toContain('testID="quiz-return-home"');
    expect(waitingBranch).toContain('router.replace("/(tabs)")');
    expect(waitingBranch).toContain("setWaitingTooLong(false)");
    expect(
      source.slice(
        source.indexOf("if (!waitingForQuestions) return;"),
        source.indexOf("subscribeToAttemptGeneration"),
      ),
    ).not.toContain("setWaitingTooLong(false)");
  });
});
