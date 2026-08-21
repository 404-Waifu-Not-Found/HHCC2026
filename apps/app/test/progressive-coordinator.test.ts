import { describe, expect, it } from "vitest";
import {
  getOrStartProgressiveGenerationTask,
  getOrStartProgressiveRecoveryTask,
  hasActiveProgressiveGenerationForAttempt,
} from "../src/generation/progressive-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("progressive generation coordinator", () => {
  it("keeps the original stream active after question one navigation", async () => {
    const background = deferred();
    const attemptId = "11111111-1111-4111-8111-111111111111";
    const task = getOrStartProgressiveGenerationTask(
      "coordinator-test-question-one",
      async ({ resolveFirst }) => {
        resolveFirst({
          attemptId,
          primer: null,
          question: {
            id: "22222222-2222-4222-8222-222222222222",
            type: "multiple_choice",
            prompt: "Which answer is supported?",
            options: ["A", "B", "C", "D"],
            difficulty: 2,
            position: 1,
            total: 5,
            isRetry: false,
          },
          generation: {
            state: "generating",
            availableQuestions: 1,
            totalQuestions: 5,
          },
        });
        await background.promise;
      },
    );

    await task.firstReady;
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(true);
    background.resolve();
    await task.completion;
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(false);
  });

  it("deduplicates and reports an active recovery task", async () => {
    const background = deferred();
    const attemptId = "33333333-3333-4333-8333-333333333333";
    const first = getOrStartProgressiveRecoveryTask(attemptId, async () => {
      await background.promise;
    });
    const second = getOrStartProgressiveRecoveryTask(
      attemptId,
      async () => undefined,
    );

    expect(second).toBe(first);
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(true);
    background.resolve();
    await first.completion;
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(false);
  });
});
