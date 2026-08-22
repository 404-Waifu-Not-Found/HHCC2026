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
    async multiGet(keys: string[]) {
      return keys.map((key) => [key, storage.get(key) ?? null]);
    },
  },
}));

import {
  bindAttemptToGeneration,
  clearGenerationRecord,
  GENERATION_RECORD_HEARTBEAT_TIMEOUT_MS,
  generationRecordForOwnerAndVideo,
  generationRecordForOwnerQuizAttempt,
  generationRecordHasLiveHeartbeat,
  loadQuestPreferences,
  loadGenerationRecord,
  loadGenerationRecordForAttempt,
  migrateLegacyGenerationRecord,
  saveGenerationRecord,
  saveGenerationState,
  saveQuestPreferences,
} from "../src/state/creation";

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ONE = "22222222-2222-4222-8222-222222222222";
const GENERATION_TWO = "33333333-3333-4333-8333-333333333333";
const SESSION_ONE = "44444444-4444-4444-8444-444444444444";
const SESSION_TWO = "55555555-5555-4555-8555-555555555555";
const KEY_ONE = "66666666-6666-4666-8666-666666666666";
const KEY_TWO = "77777777-7777-4777-8777-777777777777";
const QUIZ_ONE = "88888888-8888-4888-8888-888888888888";
const QUIZ_TWO = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECOVERY_ONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function record(
  generationId: string,
  generationSessionId: string,
  idempotencyKey: string,
) {
  return {
    version: 2 as const,
    generationId,
    generationSessionId,
    idempotencyKey,
    ownerUserId: "owner-user",
    videoId: VIDEO_ID,
    quizLanguage: "en" as const,
    questionTypes: ["multiple_choice" as const, "short_answer" as const],
    sessionLength: "short" as const,
    watched: true,
    acceptedCount: 0,
    plannedCount: 5 as const,
    state: "pending" as const,
    nextCallIndex: 0,
    createdAt: 1_786_300_000_000,
    updatedAt: 1_786_300_000_000,
  };
}

describe("generation-scoped local state", () => {
  beforeEach(() => storage.clear());

  it("keeps two intentional imports of one video fully independent", async () => {
    await saveGenerationRecord(record(GENERATION_ONE, SESSION_ONE, KEY_ONE));
    await saveGenerationRecord(record(GENERATION_TWO, SESSION_TWO, KEY_TWO));
    await bindAttemptToGeneration(GENERATION_ONE, ATTEMPT_ONE, QUIZ_ONE);
    await bindAttemptToGeneration(GENERATION_TWO, ATTEMPT_TWO, QUIZ_TWO);

    expect(await loadGenerationRecordForAttempt(ATTEMPT_ONE)).toMatchObject({
      generationId: GENERATION_ONE,
      quizId: QUIZ_ONE,
      idempotencyKey: KEY_ONE,
    });
    expect(await loadGenerationRecordForAttempt(ATTEMPT_TWO)).toMatchObject({
      generationId: GENERATION_TWO,
      quizId: QUIZ_TWO,
      idempotencyKey: KEY_TWO,
    });

    await clearGenerationRecord(GENERATION_ONE);
    expect(await loadGenerationRecord(GENERATION_ONE)).toBeNull();
    expect(await loadGenerationRecordForAttempt(ATTEMPT_ONE)).toBeNull();
    expect(await loadGenerationRecord(GENERATION_TWO)).toMatchObject({
      attemptId: ATTEMPT_TWO,
      quizId: QUIZ_TWO,
    });
  });

  it("accepts only generation records bound to the current owner and video", () => {
    const current = record(GENERATION_ONE, SESSION_ONE, KEY_ONE);

    expect(
      generationRecordForOwnerAndVideo(current, "owner-user", VIDEO_ID),
    ).toBe(current);
    expect(
      generationRecordForOwnerAndVideo(current, "another-owner", VIDEO_ID),
    ).toBeNull();
    expect(
      generationRecordForOwnerAndVideo(
        current,
        "owner-user",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    ).toBeNull();
    expect(
      generationRecordForOwnerAndVideo(null, "owner-user", VIDEO_ID),
    ).toBeNull();
  });

  it("accepts attempt recovery state only for the current owner and quiz", () => {
    const bound = {
      ...record(GENERATION_ONE, SESSION_ONE, KEY_ONE),
      attemptId: ATTEMPT_ONE,
      quizId: QUIZ_ONE,
    };
    expect(
      generationRecordForOwnerQuizAttempt(
        bound,
        "owner-user",
        QUIZ_ONE,
        ATTEMPT_ONE,
      ),
    ).toBe(bound);
    expect(
      generationRecordForOwnerQuizAttempt(
        bound,
        "another-owner",
        QUIZ_ONE,
        ATTEMPT_ONE,
      ),
    ).toBeNull();
    expect(
      generationRecordForOwnerQuizAttempt(
        bound,
        "owner-user",
        QUIZ_TWO,
        ATTEMPT_ONE,
      ),
    ).toBeNull();
  });

  it("keeps quiz preferences isolated between accounts for the same video", async () => {
    await saveQuestPreferences("owner-one", VIDEO_ID, {
      quizLanguage: "en",
      questionTypes: ["multiple_choice"],
    });
    await saveQuestPreferences("owner-two", VIDEO_ID, {
      quizLanguage: "zh-CN",
      questionTypes: ["short_answer"],
    });

    await expect(
      loadQuestPreferences("owner-one", VIDEO_ID, "zh-CN"),
    ).resolves.toEqual({
      quizLanguage: "en",
      questionTypes: ["multiple_choice"],
    });
    await expect(
      loadQuestPreferences("owner-two", VIDEO_ID, "en"),
    ).resolves.toEqual({
      quizLanguage: "zh-CN",
      questionTypes: ["short_answer"],
    });
    expect([...storage.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("clipquest:preferences:v2:owner-one:"),
        expect.stringContaining("clipquest:preferences:v2:owner-two:"),
      ]),
    );
  });

  it("defaults new quiz preferences to the selected app language", async () => {
    await expect(
      loadQuestPreferences("owner-one", VIDEO_ID, "zh-CN"),
    ).resolves.toEqual({
      quizLanguage: "zh-CN",
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
    });
  });

  it("discards ambiguous unscoped preference records", async () => {
    storage.set(
      `clipquest:preferences:${VIDEO_ID}`,
      JSON.stringify({
        quizLanguage: "zh-CN",
        questionTypes: ["short_answer"],
      }),
    );
    await expect(
      loadQuestPreferences("owner-one", VIDEO_ID, "en"),
    ).resolves.toEqual({
      quizLanguage: "en",
      questionTypes: ["multiple_choice", "true_false", "short_answer"],
    });
    expect(storage.has(`clipquest:preferences:${VIDEO_ID}`)).toBe(false);
  });

  it("migrates legacy video state only for the exact server quiz", async () => {
    await saveGenerationState(VIDEO_ID, {
      idempotencyKey: KEY_ONE,
      quizId: QUIZ_ONE,
      attemptId: ATTEMPT_ONE,
      acceptedCount: 1,
      plannedCount: 5,
    });
    expect(
      await migrateLegacyGenerationRecord({
        videoId: VIDEO_ID,
        expectedQuizId: QUIZ_TWO,
        expectedAttemptId: ATTEMPT_TWO,
        ownerUserId: "owner-user",
        generationId: GENERATION_TWO,
        generationSessionId: SESSION_TWO,
        plannedCount: 5,
        acceptedCount: 1,
        sessionLength: "short",
        quizLanguage: "en",
        questionTypes: ["multiple_choice"],
        watched: true,
      }),
    ).toBeNull();
    expect(
      await migrateLegacyGenerationRecord({
        videoId: VIDEO_ID,
        expectedQuizId: QUIZ_ONE,
        expectedAttemptId: ATTEMPT_TWO,
        ownerUserId: "owner-user",
        generationId: GENERATION_TWO,
        generationSessionId: SESSION_TWO,
        plannedCount: 5,
        acceptedCount: 1,
        sessionLength: "short",
        quizLanguage: "en",
        questionTypes: ["multiple_choice"],
        watched: true,
      }),
    ).toBeNull();
    expect(
      await migrateLegacyGenerationRecord({
        videoId: VIDEO_ID,
        expectedQuizId: QUIZ_ONE,
        expectedAttemptId: ATTEMPT_ONE,
        ownerUserId: "owner-user",
        generationId: GENERATION_ONE,
        generationSessionId: SESSION_ONE,
        plannedCount: 5,
        acceptedCount: 1,
        sessionLength: "short",
        quizLanguage: "en",
        questionTypes: ["multiple_choice"],
        watched: true,
      }),
    ).toMatchObject({
      generationId: GENERATION_ONE,
      quizId: QUIZ_ONE,
      attemptId: ATTEMPT_ONE,
      state: "retry_required",
    });
  });

  it("defers cross-tab recovery only while a generation heartbeat is live", () => {
    const current = {
      ...record(GENERATION_ONE, SESSION_ONE, KEY_ONE),
      state: "generating" as const,
    };
    expect(generationRecordHasLiveHeartbeat(current, current.updatedAt)).toBe(
      true,
    );
    expect(
      generationRecordHasLiveHeartbeat(
        current,
        current.updatedAt + GENERATION_RECORD_HEARTBEAT_TIMEOUT_MS,
      ),
    ).toBe(false);
    expect(
      generationRecordHasLiveHeartbeat(
        { ...current, state: "retry_required" },
        current.updatedAt,
      ),
    ).toBe(false);
  });

  it("persists strict automatic recovery metadata without stale retry fields", async () => {
    await saveGenerationRecord({
      version: 3,
      generationId: GENERATION_ONE,
      generationSessionId: SESSION_ONE,
      recoverySessionId: RECOVERY_ONE,
      idempotencyKey: KEY_ONE,
      ownerUserId: "owner-user",
      videoId: VIDEO_ID,
      quizLanguage: "en",
      questionTypes: ["multiple_choice"],
      sessionLength: "short",
      watched: true,
      questionPlan: {
        seed: "a".repeat(64),
        types: Array.from({ length: 5 }, () => "multiple_choice" as const),
      },
      generationProfile: "stable_auto_recovery_v5_3",
      quizId: QUIZ_ONE,
      attemptId: ATTEMPT_ONE,
      acceptedCount: 2,
      plannedCount: 5,
      state: "retrying",
      nextCallIndex: 3,
      ordinalAttempts: { "3": 2 },
      automaticRetryCount: 1,
      retryOrdinal: 3,
      ordinalAttempt: 2,
      retryKind: "content_repair",
      retryDelayMs: 250,
      createdAt: 1_786_300_000_000,
      updatedAt: 1_786_300_000_100,
    });
    expect(await loadGenerationRecord(GENERATION_ONE)).toMatchObject({
      version: 3,
      state: "retrying",
      retryOrdinal: 3,
      retryKind: "content_repair",
    });

    const current = await loadGenerationRecord(GENERATION_ONE);
    if (!current || current.version !== 3) {
      throw new Error("The automatic generation record was not stored.");
    }
    await expect(
      saveGenerationRecord({
        ...current,
        state: "generation_failed",
        retryOrdinal: undefined,
        ordinalAttempt: undefined,
        retryKind: undefined,
        retryDelayMs: undefined,
        reasonCode: undefined,
      }),
    ).rejects.toThrow();
  });
});
