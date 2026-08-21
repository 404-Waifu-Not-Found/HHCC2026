import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  DUE_REVIEW_NOTIFICATION_SQL,
  DEVICE_TOKEN_PRUNE_SQL,
  DEVICE_TOKEN_UPSERT_SQL,
  MAX_DEVICE_TOKENS_PER_USER,
  isValidExpoPushToken,
} from "../src/routes/push";
import {
  MEDIA_TOKEN_MAX_USES,
  MEDIA_USER_REQUESTS_PER_MINUTE,
  enforceMediaRequestBudget,
} from "../src/routes/media";
import {
  ANSWER_RESERVATION_SQL,
  ANSWER_RESERVATION_TTL_MS,
} from "../src/routes/quizzes";

const pushSource = await readFile(
  new URL("../src/routes/push.ts", import.meta.url),
  "utf8",
);
const mediaSource = await readFile(
  new URL("../src/routes/media.ts", import.meta.url),
  "utf8",
);
const quizSource = await readFile(
  new URL("../src/routes/quizzes.ts", import.meta.url),
  "utf8",
);
const generationSource = await readFile(
  new URL("../../app/app/generation/[videoId].tsx", import.meta.url),
  "utf8",
);
const libraryOpenSource = await readFile(
  new URL("../../app/src/hooks/useOpenVideoCard.ts", import.meta.url),
  "utf8",
);
const securityMigration = await readFile(
  new URL("../migrations/0015_security_resource_guards.sql", import.meta.url),
  "utf8",
);

describe("security resource guards", () => {
  it("bounds push-token persistence and selects due reviews before tokens", () => {
    expect(pushSource).toContain("MAX_DEVICE_TOKENS_PER_USER");
    expect(pushSource).toContain("isValidExpoPushToken");
    expect(pushSource).toMatch(
      /WITH due_reviews[\s\S]+LIMIT 100[\s\S]+LEFT JOIN device_tokens/,
    );
  });

  it("accepts real Expo token shapes and rejects prefix lookalikes", () => {
    expect(isValidExpoPushToken("ExponentPushToken[abcdefgh_12345678]")).toBe(
      true,
    );
    expect(isValidExpoPushToken("ExpoPushToken[abcdefgh-12345678]")).toBe(true);
    expect(isValidExpoPushToken("ExpoPushToken[!]")).toBe(false);
    expect(isValidExpoPushToken("ExpoPushToken[abcdefgh]trailing")).toBe(false);
    expect(isValidExpoPushToken("not-an-expo-token")).toBe(false);
  });

  it("atomically caps distinct tokens while still refreshing an existing device", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE device_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        platform TEXT NOT NULL,
        locale TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, token)
      );
    `);
    const upsert = db.prepare(DEVICE_TOKEN_UPSERT_SQL);
    const prune = db.prepare(DEVICE_TOKEN_PRUNE_SQL);
    const save = (index: number, token = `ExpoPushToken[token_${index}]`) => {
      db.exec("BEGIN");
      try {
        const stored = upsert.get(
          `id-${index}`,
          "user-1",
          token,
          "ios",
          "en",
          index,
          index,
        );
        prune.run("user-1", "user-1", MAX_DEVICE_TOKENS_PER_USER);
        db.exec("COMMIT");
        return stored;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    };

    for (let index = 0; index < MAX_DEVICE_TOKENS_PER_USER; index += 1) {
      expect(save(index)).toBeTruthy();
    }
    expect(save(99)).toBeTruthy();
    expect(
      db.prepare("SELECT id FROM device_tokens WHERE id = 'id-0'").get(),
    ).toBeUndefined();
    expect(save(100, "ExpoPushToken[token_1]")).toBeTruthy();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM device_tokens").get(),
    ).toEqual({ count: MAX_DEVICE_TOKENS_PER_USER });
  });

  it("keeps later due reviews visible when the oldest user has many invalid tokens", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE videos (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE reviews (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        scheduled_for INTEGER NOT NULL,
        notified_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE device_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        locale TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO videos VALUES ('video-a', 'Attacker lesson');
      INSERT INTO videos VALUES ('video-v', 'Victim lesson');
      INSERT INTO reviews VALUES ('review-a', 'user-a', 'video-a', 1, NULL, NULL);
      INSERT INTO reviews VALUES ('review-v', 'user-v', 'video-v', 2, NULL, NULL);
      INSERT INTO device_tokens VALUES (
        'victim-device',
        'user-v',
        'ExpoPushToken[victim_token_123]',
        'en',
        1
      );
    `);
    const invalid = db.prepare(
      "INSERT INTO device_tokens VALUES (?, 'user-a', ?, 'en', ?)",
    );
    for (let index = 0; index < 100; index += 1) {
      invalid.run(`invalid-${index}`, `invalid-token-${index}`, index);
    }

    const rows = db.prepare(DUE_REVIEW_NOTIFICATION_SQL).all(10);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.review_id)).toEqual(["review-a", "review-v"]);
    expect(rows[0]?.token).toBeNull();
    expect(rows[1]?.token).toBe("ExpoPushToken[victim_token_123]");
  });

  it("budgets every media-token read, not only token issuance", async () => {
    expect(mediaSource).toContain("enforceMediaRequestBudget");
    expect(mediaSource).toContain("MEDIA_TOKEN_MAX_USES");
    const keys: string[] = [];
    const db = {
      prepare() {
        return {
          bind(key: string) {
            keys.push(key);
            return { first: async () => ({ count: 1 }) };
          },
        };
      },
    } as unknown as D1Database;

    await enforceMediaRequestBudget(db, "user-1", "token-1");
    expect(keys).toEqual([
      "media-stream-user:user-1",
      "media-stream-token:token-1",
    ]);
    expect(MEDIA_USER_REQUESTS_PER_MINUTE).toBeGreaterThan(0);
    expect(MEDIA_TOKEN_MAX_USES).toBeGreaterThan(0);
  });

  it("requires idempotent quiz starts and reserves attempts before grading", () => {
    expect(quizSource).toContain("requireIdempotencyKey");
    expect(quizSource).toContain("reserveAttemptForAnswer");
    expect(quizSource).toContain("grading_token = ?");
    expect(generationSource).toMatch(
      /headers: \{ "Idempotency-Key": idempotencyKey \}/,
    );
    expect(libraryOpenSource).toMatch(
      /headers: \{ "Idempotency-Key": Crypto\.randomUUID\(\) \}/,
    );
  });

  it("allows only one live grading reservation for an attempt state", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_index INTEGER NOT NULL,
        current_variant INTEGER NOT NULL,
        retry_pending INTEGER NOT NULL,
        grading_token TEXT,
        grading_expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO attempts VALUES (
        'attempt-1', 'user-1', 'active', 0, 0, 0, NULL, NULL, 0
      );
    `);
    const reserve = db.prepare(ANSWER_RESERVATION_SQL);
    const now = 1_000;
    const bind = (token: string, timestamp: number) =>
      reserve.get(
        token,
        timestamp + ANSWER_RESERVATION_TTL_MS,
        timestamp,
        "attempt-1",
        "user-1",
        0,
        0,
        0,
        timestamp,
      );

    expect(bind("grading-1", now)).toEqual({ id: "attempt-1" });
    expect(bind("grading-2", now + 1)).toBeUndefined();
    expect(bind("grading-3", now + ANSWER_RESERVATION_TTL_MS + 1)).toEqual({
      id: "attempt-1",
    });
  });

  it("migrates legacy data to the bounded and idempotent schema", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
      CREATE TABLE device_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const insertToken = db.prepare(
      "INSERT INTO device_tokens VALUES (?, 'user-1', ?)",
    );
    for (let index = 0; index < 7; index += 1) {
      insertToken.run(`device-${index}`, index);
    }

    db.exec(securityMigration);

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM device_tokens").get(),
    ).toEqual({ count: MAX_DEVICE_TOKENS_PER_USER });
    expect(
      db
        .prepare("SELECT id FROM device_tokens ORDER BY updated_at")
        .all()
        .map((row) => row.id),
    ).toEqual(["device-2", "device-3", "device-4", "device-5", "device-6"]);
    db.prepare(
      "INSERT INTO attempts (id, user_id, start_key) VALUES ('attempt-1', 'user-1', 'start-1')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO attempts (id, user_id, start_key) VALUES ('attempt-2', 'user-1', 'start-1')",
        )
        .run(),
    ).toThrow();
  });
});
