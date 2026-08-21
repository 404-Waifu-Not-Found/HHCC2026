import type { QuizStartResponse } from "@clipquest/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    async getItem(key: string) {
      return storage.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      storage.set(key, value);
    },
    async removeItem(key: string) {
      storage.delete(key);
    },
    async multiRemove(keys: string[]) {
      keys.forEach((key) => storage.delete(key));
    },
    async getAllKeys() {
      return [...storage.keys()];
    },
  },
}));

import {
  clearAccountAttemptState,
  loadAttempt,
  saveAttemptQuestion,
  saveAttemptRecap,
  saveAttemptStart,
} from "../src/state/attempt";

const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const start = {
  attemptId: ATTEMPT_ID,
  primer: "A private primer for this learner.",
  question: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    type: "short_answer",
    prompt: "What concept is being assessed?",
    difficulty: 2,
    position: 1,
    total: 5,
    isRetry: false,
  },
} as QuizStartResponse;

describe("account-scoped attempt state", () => {
  beforeEach(() => storage.clear());

  it("never exposes one account's cached question to another account", async () => {
    await saveAttemptStart("owner-one", start);

    await expect(loadAttempt("owner-one", ATTEMPT_ID)).resolves.toMatchObject({
      version: 2,
      ownerUserId: "owner-one",
      attemptId: ATTEMPT_ID,
      primer: start.primer,
      question: start.question,
    });
    await expect(loadAttempt("owner-two", ATTEMPT_ID)).resolves.toBeNull();
    expect([...storage.keys()]).toEqual([
      `clipquest:attempt:v2:owner-one:${ATTEMPT_ID}`,
    ]);
  });

  it("discards ambiguous legacy and malformed owner records", async () => {
    storage.set(
      `clipquest:attempt:${ATTEMPT_ID}`,
      JSON.stringify({ attemptId: ATTEMPT_ID, question: start.question }),
    );
    storage.set(
      `clipquest:attempt:v2:owner-one:${ATTEMPT_ID}`,
      JSON.stringify({
        version: 2,
        ownerUserId: "owner-two",
        attemptId: ATTEMPT_ID,
        primer: null,
        question: start.question,
        primerSeen: true,
      }),
    );

    await expect(loadAttempt("owner-one", ATTEMPT_ID)).resolves.toBeNull();
    expect(storage.size).toBe(0);
  });

  it("clears only the departing account's current records", async () => {
    await saveAttemptStart("owner-one", start);
    await saveAttemptStart("owner-two", {
      ...start,
      attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    await clearAccountAttemptState("owner-one");

    expect(storage.has(`clipquest:attempt:v2:owner-one:${ATTEMPT_ID}`)).toBe(
      false,
    );
    expect(
      storage.has(
        "clipquest:attempt:v2:owner-two:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ),
    ).toBe(true);
  });

  it("keeps the session recap across question updates and reloads", async () => {
    await saveAttemptStart("owner-one", start);
    const recap = [
      {
        questionId: start.question.id,
        prompt: start.question.prompt,
        correct: false,
        isRetry: false,
        learnerAnswer: "Spacing",
        correctAnswer: "Retrieval practice",
        explanation: "Recalling the idea rebuilds it.",
      },
    ];

    await saveAttemptRecap("owner-one", ATTEMPT_ID, recap);
    await saveAttemptQuestion("owner-one", ATTEMPT_ID, {
      ...start.question,
      prompt: "Try again: what concept is being assessed?",
      isRetry: true,
    });

    await expect(loadAttempt("owner-one", ATTEMPT_ID)).resolves.toMatchObject({
      question: { isRetry: true },
      recap,
    });
  });

  it("loads records written before the recap existed with an empty recap", async () => {
    storage.set(
      `clipquest:attempt:v2:owner-one:${ATTEMPT_ID}`,
      JSON.stringify({
        version: 2,
        ownerUserId: "owner-one",
        attemptId: ATTEMPT_ID,
        primer: null,
        question: start.question,
        primerSeen: true,
      }),
    );

    await expect(loadAttempt("owner-one", ATTEMPT_ID)).resolves.toMatchObject({
      question: start.question,
      recap: [],
    });
  });
});
