import { describe, expect, it } from "vitest";
import {
  cancelProgressiveRecoveryTask,
  getOrStartProgressiveGenerationTask,
  getOrStartProgressiveRecoveryTask,
  hasActiveProgressiveGenerationForAttempt,
  pauseAllProgressiveGenerationTasks,
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

  it("replaces a stale recovery task when the learner retries", async () => {
    const firstAbort = deferred();
    const attemptId = "66666666-6666-4666-8666-666666666666";
    const first = getOrStartProgressiveRecoveryTask(
      attemptId,
      async (signal) => {
        if (signal.aborted) {
          firstAbort.resolve();
          return;
        }
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              firstAbort.resolve();
              resolve();
            },
            { once: true },
          ),
        );
      },
    );
    cancelProgressiveRecoveryTask(attemptId);
    const second = getOrStartProgressiveRecoveryTask(
      attemptId,
      async () => undefined,
    );

    expect(second).not.toBe(first);
    await firstAbort.promise;
    await Promise.all([first.completion, second.completion]);
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(false);
  });

  it("aborts generation and recovery when Android enters the background", async () => {
    const attemptId = "44444444-4444-4444-8444-444444444444";
    const generation = getOrStartProgressiveGenerationTask(
      "coordinator-test-native-background",
      async ({ signal, resolveFirst }) => {
        resolveFirst({
          attemptId,
          primer: null,
          question: {
            id: "55555555-5555-4555-8555-555555555555",
            type: "true_false",
            prompt: "This is a test statement.",
            difficulty: 1,
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
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );
    const recovery = getOrStartProgressiveRecoveryTask(
      attemptId,
      async (signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );

    await generation.firstReady;
    pauseAllProgressiveGenerationTasks();
    expect(generation.controller.signal.aborted).toBe(true);
    await Promise.all([generation.completion, recovery.completion]);
    expect(hasActiveProgressiveGenerationForAttempt(attemptId)).toBe(false);
  });
});
